import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { requireAdmin } from '../../middleware/admin';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { paginatedResponse } from '../../responses/response';
import {
  adminListProductsQuerySchema,
  type AdminListProductsQuery,
} from '../../schemas/product.schema';
import { createProductService, type ProductService } from '../../services/product.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `GET /api/v1/admin/products`
 *
 * Admin only. Same underlying `Query` against GSI1 as the public listing,
 * but accepts a `status` filter (defaults to ACTIVE) so the admin dashboard
 * can see DRAFT and ARCHIVED products too. GSI1 partitions by status, so
 * this — like the public endpoint — lists one status at a time rather than
 * merging all three partitions; the dashboard exposes this as a status tab.
 */

let defaultService: ProductService | undefined;
function getDefaultService(): ProductService {
  defaultService ??= createProductService();
  return defaultService;
}

const DEFAULT_LIMIT = 20;

export function buildAdminListProductsHandler(service?: ProductService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { query } = requireValidated<{ query: AdminListProductsQuery }>(event);
    const page = await (service ?? getDefaultService()).listProducts(query);
    return paginatedResponse(
      page.items,
      { nextCursor: page.cursor, limit: query.limit ?? DEFAULT_LIMIT },
      getRequestId(event),
    );
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(requireAdmin())
    .use(validate({ query: adminListProductsQuerySchema }))
    .use(errorHandler());
}

export const handler = buildAdminListProductsHandler();
