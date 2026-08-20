import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { requireAuthentication, requireCurrentUser } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error-handler';
import { successResponse } from '../../responses/response';
import { createCartService, type CartService } from '../../services/cart.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';

/**
 * `GET /api/v1/cart`
 *
 * Authenticated. Always returns the *caller's own* cart: the user id comes
 * from `requireCurrentUser()` (the verified JWT `sub` claim) — there is no
 * `userId` path/query parameter for a client to point at someone else's
 * cart. Prices, names, and the subtotal are computed server-side from
 * current product/inventory records on every read.
 */

let defaultService: CartService | undefined;
function getDefaultService(): CartService {
  defaultService ??= createCartService();
  return defaultService;
}

export function buildGetCartHandler(service?: CartService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const user = requireCurrentUser(event);
    const cart = await (service ?? getDefaultService()).getCart(user.userId);
    return successResponse(cart, getRequestId(event));
  };

  return middy(baseHandler).use(httpCors()).use(requireAuthentication()).use(errorHandler());
}

export const handler = buildGetCartHandler();
