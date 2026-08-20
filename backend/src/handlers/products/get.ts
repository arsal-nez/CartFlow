import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import { productIdPathSchema, type ProductIdPath } from '../../schemas/product.schema';
import { createProductService, type ProductService } from '../../services/product.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `GET /api/v1/products/{id}`
 *
 * Public, unauthenticated. A single `GetItem` on `PK=PRODUCT#{id}, SK=META`.
 * Returns 404 `NOT_FOUND` when the product does not exist.
 */

let defaultService: ProductService | undefined;
function getDefaultService(): ProductService {
  defaultService ??= createProductService();
  return defaultService;
}

export function buildGetProductHandler(service?: ProductService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { path } = requireValidated<{ path: ProductIdPath }>(event);
    const product = await (service ?? getDefaultService()).getProduct(path.id);
    return successResponse(product, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(validate({ path: productIdPathSchema }))
    .use(errorHandler());
}

export const handler = buildGetProductHandler();
