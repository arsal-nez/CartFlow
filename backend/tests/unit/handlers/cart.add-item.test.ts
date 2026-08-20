import { buildAddCartItemHandler } from '../../../src/handlers/cart/add-item';
import {
  ConflictError,
  InventoryUnavailableError,
  NotFoundError,
} from '../../../src/errors/app-error';
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
      quantity: 2,
      lineTotalCents: 4998,
      productAvailable: true,
      availableQuantity: 10,
    },
  ],
  subtotalCents: 4998,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('POST /api/v1/cart/items', () => {
  it('adds the item and returns 201 for the authenticated caller', async () => {
    const fake = createFakeCartService();
    fake.addItem.mockResolvedValueOnce(SAMPLE_CART);
    const handler = buildAddCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 2 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(201);
    expect(parseBody(result)).toMatchObject({ ok: true, data: SAMPLE_CART });
    expect(fake.addItem).toHaveBeenCalledWith('user-1', PRODUCT_ID, 2);
  });

  it('ignores a client-supplied userId in the body and uses the verified JWT subject instead', async () => {
    const fake = createFakeCartService();
    fake.addItem.mockResolvedValueOnce(SAMPLE_CART);
    const handler = buildAddCartItemHandler(fake.service);

    await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 1, userId: 'attacker-supplied-id' },
        claims: { sub: 'real-user' },
      }),
      fakeLambdaContext,
    );

    expect(fake.addItem).toHaveBeenCalledWith('real-user', PRODUCT_ID, 1);
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeCartService();
    const handler = buildAddCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 1 },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(fake.addItem).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a non-positive quantity, without calling the service', async () => {
    const fake = createFakeCartService();
    const handler = buildAddCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 0 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.addItem).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a malformed productId', async () => {
    const fake = createFakeCartService();
    const handler = buildAddCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: 'not-a-uuid', quantity: 1 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(fake.addItem).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the product does not exist', async () => {
    const fake = createFakeCartService();
    fake.addItem.mockRejectedValueOnce(new NotFoundError(`Product ${PRODUCT_ID} not found`));
    const handler = buildAddCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 1 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 409 CONFLICT when the product is not active', async () => {
    const fake = createFakeCartService();
    fake.addItem.mockRejectedValueOnce(
      new ConflictError(`Product ${PRODUCT_ID} is not available for purchase`),
    );
    const handler = buildAddCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 1 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).error).toMatchObject({ code: 'CONFLICT' });
  });

  it('returns 409 INVENTORY_UNAVAILABLE when the quantity exceeds stock', async () => {
    const fake = createFakeCartService();
    fake.addItem.mockRejectedValueOnce(
      new InventoryUnavailableError('Only 3 unit(s) are available'),
    );
    const handler = buildAddCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 100 },
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
    fake.addItem.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildAddCartItemHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 1 },
        claims: USER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
