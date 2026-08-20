import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import { productIdPathSchema, type ProductIdPath } from '../../schemas/product.schema';
import { createInventoryService, type InventoryService } from '../../services/inventory.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `GET /api/v1/products/{id}/inventory`
 *
 * Public, unauthenticated — same visibility as `GET /api/v1/products/{id}`.
 * Lets the storefront show real stock ("in stock" / "N left" / "out of
 * stock") without hard-coding it, while keeping admin-only inventory
 * fields (`reservedQuantity`, `reorderThreshold`) out of the public
 * response. Never 404s — see `InventoryService.getPublicStock`.
 */

let defaultService: InventoryService | undefined;
function getDefaultService(): InventoryService {
  defaultService ??= createInventoryService();
  return defaultService;
}

export function buildGetProductInventoryHandler(service?: InventoryService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { path } = requireValidated<{ path: ProductIdPath }>(event);
    const stock = await (service ?? getDefaultService()).getPublicStock(path.id);
    return successResponse(stock, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(validate({ path: productIdPathSchema }))
    .use(errorHandler());
}

export const handler = buildGetProductInventoryHandler();
