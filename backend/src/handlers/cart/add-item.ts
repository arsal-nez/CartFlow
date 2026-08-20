import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import httpJsonBodyParser from '@middy/http-json-body-parser';

import { requireAuthentication, requireCurrentUser } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error-handler';
import { idempotency } from '../../middleware/idempotency';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import type { IdempotencyRepository } from '../../repositories/idempotency.repository';
import { addCartItemBodySchema, type AddCartItemBody } from '../../schemas/cart.schema';
import { createCartService, type CartService } from '../../services/cart.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `POST /api/v1/cart/items`
 *
 * Authenticated. Adds `quantity` units of `productId` to the caller's own
 * cart, incrementing the existing line if the product is already present.
 * Rejects a nonexistent or non-`ACTIVE` product and a quantity beyond what
 * `InventoryRepository` reports as available. Price and subtotal are never
 * read from the request — see `CartService.addItem`. Also idempotent when
 * the caller sends an `Idempotency-Key` header — see `middleware/idempotency.ts`.
 */

let defaultService: CartService | undefined;
function getDefaultService(): CartService {
  defaultService ??= createCartService();
  return defaultService;
}

/**
 * `idempotencyRepository` is a test-only seam (mirrors the existing
 * `service` parameter): the default (omitted) case wires the real
 * DynamoDB-backed repository, exactly like every other handler factory in
 * this codebase.
 */
export function buildAddCartItemHandler(
  service?: CartService,
  idempotencyRepository?: IdempotencyRepository,
) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const user = requireCurrentUser(event);
    const { body } = requireValidated<{ body: AddCartItemBody }>(event);
    const cart = await (service ?? getDefaultService()).addItem(
      user.userId,
      body.productId,
      body.quantity,
    );
    return successResponse(cart, getRequestId(event), 201);
  };

  return (
    middy(baseHandler)
      // Registered before `httpCors()` on purpose — see the "Registration
      // order matters" note in `middleware/idempotency.ts`'s doc comment for
      // exactly why a replayed response would otherwise be missing its CORS
      // headers. `getCurrentUser()` (used to scope the key per caller) reads
      // directly off the raw, API-Gateway-verified event and doesn't need
      // `requireAuthentication()` to have run first; that middleware's own
      // 401 still fires normally for any request that isn't a cache hit.
      .use(idempotency({ namespace: 'cart-add-item', repository: idempotencyRepository }))
      .use(httpCors())
      .use(httpJsonBodyParser({ disableContentTypeError: true }))
      .use(requireAuthentication())
      .use(validate({ body: addCartItemBodySchema }))
      .use(errorHandler())
  );
}

export const handler = buildAddCartItemHandler();
