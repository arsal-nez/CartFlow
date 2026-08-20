import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { requireAuthentication, requireCurrentUser } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import { cartItemProductIdPathSchema, type CartItemProductIdPath } from '../../schemas/cart.schema';
import { createCartService, type CartService } from '../../services/cart.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `DELETE /api/v1/cart/items/{productId}`
 *
 * Authenticated. Removes a line from the caller's own cart entirely — 404s
 * if the product isn't in the cart.
 */

let defaultService: CartService | undefined;
function getDefaultService(): CartService {
  defaultService ??= createCartService();
  return defaultService;
}

export function buildRemoveCartItemHandler(service?: CartService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const user = requireCurrentUser(event);
    const { path } = requireValidated<{ path: CartItemProductIdPath }>(event);
    const cart = await (service ?? getDefaultService()).removeItem(user.userId, path.productId);
    return successResponse(cart, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(requireAuthentication())
    .use(validate({ path: cartItemProductIdPathSchema }))
    .use(errorHandler());
}

export const handler = buildRemoveCartItemHandler();
