import { buildRemoveCartItemHandler } from '../../../src/handlers/cart/remove-item';
import { NotFoundError } from '../../../src/errors/app-error';
import { createFakeCartService } from '../helpers/fake-cart-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const USER_CLAIMS = { sub: 'user-1' };
const SAMPLE_CART = {
  userId: 'user-1',
  currency: 'USD',
  items: [],
  subtotalCents: 0,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('DELETE /api/v1/cart/items/{productId}', () => {
  it('removes the line for the authenticated caller', async () => {
    const fake = createFakeCartService();
    fake.removeItem.mockResolvedValueOnce(SAMPLE_CART);
    const handler = buildRemoveCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'DELETE',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: SAMPLE_CART });
    expect(fake.removeItem).toHaveBeenCalledWith('user-1', PRODUCT_ID);
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeCartService();
    const handler = buildRemoveCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'DELETE',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(fake.removeItem).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a malformed productId', async () => {
    const fake = createFakeCartService();
    const handler = buildRemoveCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'DELETE',
        path: '/api/v1/cart/items/not-a-uuid',
        pathParameters: { productId: 'not-a-uuid' },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(fake.removeItem).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the product is not in the cart', async () => {
    const fake = createFakeCartService();
    fake.removeItem.mockRejectedValueOnce(
      new NotFoundError(`Product ${PRODUCT_ID} is not in the cart`),
    );
    const handler = buildRemoveCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'DELETE',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeCartService();
    fake.removeItem.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildRemoveCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'DELETE',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
