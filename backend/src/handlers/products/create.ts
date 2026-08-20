import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import httpJsonBodyParser from '@middy/http-json-body-parser';

import { requireAdmin } from '../../middleware/admin';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import { createProductBodySchema, type CreateProductBody } from '../../schemas/product.schema';
import { createProductService, type ProductService } from '../../services/product.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `POST /api/v1/products`
 *
 * Admin only. Creates a product with a server-generated UUID `productId`;
 * `PutItem` is conditioned on the item not already existing, so a duplicate
 * raises 409 `CONFLICT` rather than silently overwriting.
 */

let defaultService: ProductService | undefined;
function getDefaultService(): ProductService {
  defaultService ??= createProductService();
  return defaultService;
}

export function buildCreateProductHandler(service?: ProductService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { body } = requireValidated<{ body: CreateProductBody }>(event);
    const product = await (service ?? getDefaultService()).createProduct(body);
    return successResponse(product, getRequestId(event), 201);
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(requireAdmin())
    .use(validate({ body: createProductBodySchema }))
    .use(errorHandler());
}

export const handler = buildCreateProductHandler();
