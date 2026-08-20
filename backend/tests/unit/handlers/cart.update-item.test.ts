import { buildUpdateCartItemHandler } from '../../../src/handlers/cart/update-item';
import { InventoryUnavailableError, NotFoundError } from '../../../src/errors/app-error';
import { createFakeCartService } from '../helpers/fake-cart-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const USER_CLAIMS = { sub: 'user-1' };
const SAMPLE_CART = {
  userId: 'user-1',
  currency: 'USD',
  items: [
    {
      productId: PRODUCT_ID,
      name: 'Trail Bottle',
      priceCents: 2499,
      currency: 'USD',
      quantity: 7,
      lineTotalCents: 17493,
      productAvailable: true,
      availableQuantity: 10,
    },
  ],
  subtotalCents: 17493,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('PATCH /api/v1/cart/items/{productId}', () => {
  it('sets the line to the absolute quantity for the authenticated caller', async () => {
    const fake = createFakeCartService();
    fake.updateItemQuantity.mockResolvedValueOnce(SAMPLE_CART);
    const handler = buildUpdateCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PATCH',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        body: { quantity: 7 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: SAMPLE_CART });
    expect(fake.updateItemQuantity).toHaveBeenCalledWith('user-1', PRODUCT_ID, 7);
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeCartService();
    const handler = buildUpdateCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PATCH',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        body: { quantity: 7 },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(fake.updateItemQuantity).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a zero quantity', async () => {
    const fake = createFakeCartService();
    const handler = buildUpdateCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PATCH',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        body: { quantity: 0 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.updateItemQuantity).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a malformed productId path parameter', async () => {
    const fake = createFakeCartService();
    const handler = buildUpdateCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PATCH',
        path: '/api/v1/cart/items/not-a-uuid',
        pathParameters: { productId: 'not-a-uuid' },
        body: { quantity: 1 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(fake.updateItemQuantity).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the product is not already in the cart', async () => {
    const fake = createFakeCartService();
    fake.updateItemQuantity.mockRejectedValueOnce(
      new NotFoundError(`Product ${PRODUCT_ID} is not in the cart`),
    );
    const handler = buildUpdateCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PATCH',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        body: { quantity: 3 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 409 INVENTORY_UNAVAILABLE when raising the quantity exceeds stock', async () => {
    const fake = createFakeCartService();
    fake.updateItemQuantity.mockRejectedValueOnce(
      new InventoryUnavailableError('Only 3 unit(s) are available'),
    );
    const handler = buildUpdateCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PATCH',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        body: { quantity: 999 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).error).toMatchObject({ code: 'INVENTORY_UNAVAILABLE' });
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeCartService();
    fake.updateItemQuantity.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildUpdateCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PATCH',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        body: { quantity: 3 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
