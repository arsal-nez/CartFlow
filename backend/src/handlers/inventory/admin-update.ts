import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import httpJsonBodyParser from '@middy/http-json-body-parser';

import { requireAdmin } from '../../middleware/admin';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import {
  productIdPathSchema,
  updateInventoryBodySchema,
  type ProductIdPath,
  type UpdateInventoryBody,
} from '../../schemas/inventory.schema';
import { createInventoryService, type InventoryService } from '../../services/inventory.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `PUT /api/v1/admin/inventory/{id}`
 *
 * Admin only. Sets an absolute `availableQuantity` and/or `reorderThreshold`
 * for a product — see `InventoryService.updateStock`. If the product has
 * never been stocked, this call creates the inventory record; in that case
 * `availableQuantity` is required (the repository has nothing to default it
 * from).
 */

let defaultService: InventoryService | undefined;
function getDefaultService(): InventoryService {
  defaultService ??= createInventoryService();
  return defaultService;
}

export function buildAdminUpdateInventoryHandler(service?: InventoryService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { path, body } = requireValidated<{ path: ProductIdPath; body: UpdateInventoryBody }>(
      event,
    );
    const stock = await (service ?? getDefaultService()).updateStock(path.id, body);
    return successResponse(stock, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(requireAdmin())
    .use(validate({ path: productIdPathSchema, body: updateInventoryBodySchema }))
    .use(errorHandler());
}

export const handler = buildAdminUpdateInventoryHandler();
