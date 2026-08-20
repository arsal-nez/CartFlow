import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import httpJsonBodyParser from '@middy/http-json-body-parser';

import { requireAdmin } from '../../middleware/admin';
import { errorHandler } from '../../middleware/error-handler';
import { idempotency } from '../../middleware/idempotency';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import { createProductBodySchema, type CreateProductBody } from '../../schemas/product.schema';
import type { IdempotencyRepository } from '../../repositories/idempotency.repository';
import { createProductService, type ProductService } from '../../services/product.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `POST /api/v1/products`
 *
 * Admin only. Creates a product with a server-generated UUID `productId`;
 * `PutItem` is conditioned on the item not already existing, so a duplicate
 * raises 409 `CONFLICT` rather than silently overwriting. Also idempotent
 * when the caller sends an `Idempotency-Key` header — see
 * `middleware/idempotency.ts`.
 */

let defaultService: ProductService | undefined;
function getDefaultService(): ProductService {
  defaultService ??= createProductService();
  return defaultService;
}

/**
 * `idempotencyRepository` is a test-only seam (mirrors the existing
 * `service` parameter): the default (omitted) case wires the real
 * DynamoDB-backed repository, exactly like every other handler factory in
 * this codebase.
 */
export function buildCreateProductHandler(
  service?: ProductService,
  idempotencyRepository?: IdempotencyRepository,
) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { body } = requireValidated<{ body: CreateProductBody }>(event);
    const product = await (service ?? getDefaultService()).createProduct(body);
    return successResponse(product, getRequestId(event), 201);
  };

  return (
    middy(baseHandler)
      // Registered before `httpCors()` on purpose — see the "Registration
      // order matters" note in `middleware/idempotency.ts`'s doc comment. A
      // cache hit can only ever occur for a scope key namespaced by the
      // *current* caller's own verified `sub` claim, and a record only ever
      // gets saved after a request has already passed `requireAdmin()`
      // successfully — so running before `requireAdmin()` here doesn't grant
      // a non-admin caller anything; `requireAdmin()`'s own 403 still fires
      // normally for any request that isn't a cache hit.
      .use(idempotency({ namespace: 'product-create', repository: idempotencyRepository }))
      .use(httpCors())
      .use(httpJsonBodyParser({ disableContentTypeError: true }))
      .use(requireAdmin())
      .use(validate({ body: createProductBodySchema }))
      .use(errorHandler())
  );
}

export const handler = buildCreateProductHandler();
