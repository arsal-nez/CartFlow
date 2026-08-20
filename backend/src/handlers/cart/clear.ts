import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { requireAuthentication, requireCurrentUser } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error-handler';
import { successResponse } from '../../responses/response';
import { createCartService, type CartService } from '../../services/cart.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';

/**
 * `DELETE /api/v1/cart`
 *
 * Authenticated. Empties every line from the caller's own cart. Idempotent:
 * a cart that doesn't exist yet, or is already empty, is a normal success,
 * not a 404.
 */

let defaultService: CartService | undefined;
function getDefaultService(): CartService {
  defaultService ??= createCartService();
  return defaultService;
}

export function buildClearCartHandler(service?: CartService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const user = requireCurrentUser(event);
    const cart = await (service ?? getDefaultService()).clearCart(user.userId);
    return successResponse(cart, getRequestId(event));
  };

  return middy(baseHandler).use(httpCors()).use(requireAuthentication()).use(errorHandler());
}

export const handler = buildClearCartHandler();
