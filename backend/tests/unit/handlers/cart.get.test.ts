import { buildGetCartHandler } from '../../../src/handlers/cart/get';
import { createFakeCartService } from '../helpers/fake-cart-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const SAMPLE_CART = {
  userId: 'user-1',
  currency: 'USD',
  items: [
    {
      productId: '11111111-1111-4111-8111-111111111111',
      name: 'Trail Bottle',
      priceCents: 2499,
      currency: 'USD',
      quantity: 2,
      lineTotalCents: 4998,
      productAvailable: true,
      availableQuantity: 10,
    },
  ],
  subtotalCents: 4998,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const USER_CLAIMS = { sub: 'user-1' };

describe('GET /api/v1/cart', () => {
  it("returns the caller's own cart on success", async () => {
    const fake = createFakeCartService();
    fake.getCart.mockResolvedValueOnce(SAMPLE_CART);
    const handler = buildGetCartHandler(fake.service);

    const result = await handler(
      buildEvent({ path: '/api/v1/cart', claims: USER_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: SAMPLE_CART });
    expect(fake.getCart).toHaveBeenCalledWith('user-1');
  });

  it('derives the user id from the verified JWT, ignoring any client-supplied userId', async () => {
    const fake = createFakeCartService();
    fake.getCart.mockResolvedValueOnce(SAMPLE_CART);
    const handler = buildGetCartHandler(fake.service);

    await handler(
      buildEvent({
        path: '/api/v1/cart',
        claims: { sub: 'real-user' },
        queryStringParameters: { userId: 'attacker-supplied-id' },
      }),
      fakeLambdaContext,
    );

    expect(fake.getCart).toHaveBeenCalledWith('real-user');
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeCartService();
    const handler = buildGetCartHandler(fake.service);

    const result = await handler(buildEvent({ path: '/api/v1/cart' }), fakeLambdaContext);

    expect(result.statusCode).toBe(401);
    expect(parseBody(result).error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fake.getCart).not.toHaveBeenCalled();
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeCartService();
    fake.getCart.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildGetCartHandler(fake.service);

    const result = await handler(
      buildEvent({ path: '/api/v1/cart', claims: USER_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
