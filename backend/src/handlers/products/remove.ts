import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { requireAdmin } from '../../middleware/admin';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import { productIdPathSchema, type ProductIdPath } from '../../schemas/product.schema';
import { createProductService, type ProductService } from '../../services/product.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `DELETE /api/v1/products/{id}`
 *
 * Admin only. Soft delete: flips `status` to `ARCHIVED` rather than removing
 * the item, so order history and inventory records that reference the
 * product keep resolving. Returns the archived product per the shared
 * success response contract (a 204 has no body, which the contract requires).
 */

let defaultService: ProductService | undefined;
function getDefaultService(): ProductService {
  defaultService ??= createProductService();
  return defaultService;
}

export function buildDeleteProductHandler(service?: ProductService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { path } = requireValidated<{ path: ProductIdPath }>(event);
    const product = await (service ?? getDefaultService()).deleteProduct(path.id);
    return successResponse(product, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(requireAdmin())
    .use(validate({ path: productIdPathSchema }))
    .use(errorHandler());
}

export const handler = buildDeleteProductHandler();
