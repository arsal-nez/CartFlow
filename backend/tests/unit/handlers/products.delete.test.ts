import { buildDeleteProductHandler } from '../../../src/handlers/products/remove';
import { resetEnvConfig } from '../../../src/config/env';
import { NotFoundError } from '../../../src/errors/app-error';
import { createFakeProductService } from '../helpers/fake-product-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const ARCHIVED_PRODUCT = {
  productId: PRODUCT_ID,
  name: 'Trail Bottle',
  normalizedName: 'trail-bottle',
  description: 'Insulated bottle',
  categoryId: 'drinkware',
  status: 'ARCHIVED' as const,
  priceCents: 1999,
  currency: 'USD',
  imageKeys: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

const ADMIN_CLAIMS = { sub: 'admin-1', 'cognito:groups': '["admin"]' };

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv, CARTFLOW_TABLE_NAME: 'cartflow-test', ADMIN_GROUP_NAME: 'admin' };
  resetEnvConfig();
});

afterAll(() => {
  process.env = originalEnv;
  resetEnvConfig();
});

describe('DELETE /api/v1/products/{id}', () => {
  it('deactivates the product for an admin caller', async () => {
    const fake = createFakeProductService();
    fake.deleteProduct.mockResolvedValueOnce(ARCHIVED_PRODUCT);
    const handler = buildDeleteProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', pathParameters: { id: PRODUCT_ID }, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: ARCHIVED_PRODUCT });
    expect(fake.deleteProduct).toHaveBeenCalledWith(PRODUCT_ID);
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeProductService();
    const handler = buildDeleteProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(fake.deleteProduct).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for a non-admin caller', async () => {
    const fake = createFakeProductService();
    const handler = buildDeleteProductHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'DELETE',
        pathParameters: { id: PRODUCT_ID },
        claims: { sub: 'user-1', 'cognito:groups': '["customer"]' },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(fake.deleteProduct).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a malformed id', async () => {
    const fake = createFakeProductService();
    const handler = buildDeleteProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', pathParameters: { id: 'not-a-uuid' }, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(fake.deleteProduct).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the product does not exist', async () => {
    const fake = createFakeProductService();
    fake.deleteProduct.mockRejectedValueOnce(new NotFoundError(`Product ${PRODUCT_ID} not found`));
    const handler = buildDeleteProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', pathParameters: { id: PRODUCT_ID }, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeProductService();
    fake.deleteProduct.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildDeleteProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'DELETE', pathParameters: { id: PRODUCT_ID }, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
