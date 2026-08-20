import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import httpJsonBodyParser from '@middy/http-json-body-parser';

import { requireAuthentication, requireCurrentUser } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import {
  cartItemProductIdPathSchema,
  updateCartItemBodySchema,
  type CartItemProductIdPath,
  type UpdateCartItemBody,
} from '../../schemas/cart.schema';
import { createCartService, type CartService } from '../../services/cart.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `PATCH /api/v1/cart/items/{productId}`
 *
 * Authenticated. Sets an existing line to an absolute quantity — 404s if the
 * product isn't already in the caller's cart (use `POST /cart/items` to add
 * it). Same product-active and inventory-availability checks as add.
 */

let defaultService: CartService | undefined;
function getDefaultService(): CartService {
  defaultService ??= createCartService();
  return defaultService;
}

export function buildUpdateCartItemHandler(service?: CartService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const user = requireCurrentUser(event);
    const { path, body } = requireValidated<{
      path: CartItemProductIdPath;
      body: UpdateCartItemBody;
    }>(event);
    const cart = await (service ?? getDefaultService()).updateItemQuantity(
      user.userId,
      path.productId,
      body.quantity,
    );
    return successResponse(cart, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(requireAuthentication())
    .use(validate({ path: cartItemProductIdPathSchema, body: updateCartItemBodySchema }))
    .use(errorHandler());
}

export const handler = buildUpdateCartItemHandler();
