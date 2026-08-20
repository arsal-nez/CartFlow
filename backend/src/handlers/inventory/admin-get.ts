import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { requireAdmin } from '../../middleware/admin';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import { productIdPathSchema, type ProductIdPath } from '../../schemas/inventory.schema';
import { createInventoryService, type InventoryService } from '../../services/inventory.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `GET /api/v1/admin/inventory/{id}`
 *
 * Admin only. Returns the full inventory record (available, reserved,
 * reorder threshold) — see `InventoryService.getAdminStock`. Never 404s: a
 * product that has never been stocked reports zero, `updatedAt: null`.
 */

let defaultService: InventoryService | undefined;
function getDefaultService(): InventoryService {
  defaultService ??= createInventoryService();
  return defaultService;
}

export function buildAdminGetInventoryHandler(service?: InventoryService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { path } = requireValidated<{ path: ProductIdPath }>(event);
    const stock = await (service ?? getDefaultService()).getAdminStock(path.id);
    return successResponse(stock, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(requireAdmin())
    .use(validate({ path: productIdPathSchema }))
    .use(errorHandler());
}

export const handler = buildAdminGetInventoryHandler();
