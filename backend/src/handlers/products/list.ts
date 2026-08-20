import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { paginatedResponse } from '../../responses/response';
import { listProductsQuerySchema, type ListProductsQuery } from '../../schemas/product.schema';
import { createProductService, type ProductService } from '../../services/product.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `GET /api/v1/products`
 *
 * Public, unauthenticated. Lists active products, optionally scoped to a
 * category, via a `Query` against GSI1 (no `Scan`) — see
 * `docs/database.md#product-access-patterns`.
 */

let defaultService: ProductService | undefined;
function getDefaultService(): ProductService {
  defaultService ??= createProductService();
  return defaultService;
}

const DEFAULT_LIMIT = 20;

export function buildListProductsHandler(service?: ProductService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { query } = requireValidated<{ query: ListProductsQuery }>(event);
    const page = await (service ?? getDefaultService()).listProducts(query);
    return paginatedResponse(
      page.items,
      { nextCursor: page.cursor, limit: query.limit ?? DEFAULT_LIMIT },
      getRequestId(event),
    );
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(validate({ query: listProductsQuerySchema }))
    .use(errorHandler());
}

export const handler = buildListProductsHandler();
