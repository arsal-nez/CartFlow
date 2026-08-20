import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import httpJsonBodyParser from '@middy/http-json-body-parser';

import { requireAdmin } from '../../middleware/admin';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import {
  productIdPathSchema,
  updateProductBodySchema,
  type ProductIdPath,
  type UpdateProductBody,
} from '../../schemas/product.schema';
import { createProductService, type ProductService } from '../../services/product.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `PUT /api/v1/products/{id}`
 *
 * Admin only. Partial update of editable fields: any subset of `name`,
 * `description`, `categoryId`, `priceCents`, `currency`, `status` may be
 * supplied, but at least one is required. `productId` comes only from the
 * path. Optimistically concurrent — see `ProductRepository.update`.
 */

let defaultService: ProductService | undefined;
function getDefaultService(): ProductService {
  defaultService ??= createProductService();
  return defaultService;
}

export function buildUpdateProductHandler(service?: ProductService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { path, body } = requireValidated<{ path: ProductIdPath; body: UpdateProductBody }>(
      event,
    );
    const product = await (service ?? getDefaultService()).updateProduct(path.id, body);
    return successResponse(product, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(requireAdmin())
    .use(validate({ path: productIdPathSchema, body: updateProductBodySchema }))
    .use(errorHandler());
}

export const handler = buildUpdateProductHandler();
