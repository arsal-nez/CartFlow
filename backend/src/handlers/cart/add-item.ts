import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import httpJsonBodyParser from '@middy/http-json-body-parser';

import { requireAuthentication, requireCurrentUser } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
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
 * read from the request — see `CartService.addItem`.
 */

let defaultService: CartService | undefined;
function getDefaultService(): CartService {
  defaultService ??= createCartService();
  return defaultService;
}

export function buildAddCartItemHandler(service?: CartService) {
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

  return middy(baseHandler)
    .use(httpCors())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(requireAuthentication())
    .use(validate({ body: addCartItemBodySchema }))
    .use(errorHandler());
}

export const handler = buildAddCartItemHandler();
