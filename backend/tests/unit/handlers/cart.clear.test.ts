import { buildClearCartHandler } from '../../../src/handlers/cart/clear';
import { createFakeCartService } from '../helpers/fake-cart-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const USER_CLAIMS = { sub: 'user-1' };
const EMPTY_CART = {
  userId: 'user-1',
  currency: 'USD',
  items: [],
  subtotalCents: 0,
  updatedAt: null,
};

describe('DELETE /api/v1/cart', () => {
  it('empties the cart for the authenticated caller', async () => {
    const fake = createFakeCartService();
    fake.clearCart.mockResolvedValueOnce(EMPTY_CART);
    const handler = buildClearCartHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', path: '/api/v1/cart', claims: USER_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: EMPTY_CART });
    expect(fake.clearCart).toHaveBeenCalledWith('user-1');
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeCartService();
    const handler = buildClearCartHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', path: '/api/v1/cart' }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(fake.clearCart).not.toHaveBeenCalled();
  });

  it('succeeds (idempotent) even when the caller has no cart yet', async () => {
    const fake = createFakeCartService();
    fake.clearCart.mockResolvedValueOnce(EMPTY_CART);
    const handler = buildClearCartHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', path: '/api/v1/cart', claims: USER_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeCartService();
    fake.clearCart.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildClearCartHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', path: '/api/v1/cart', claims: USER_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
