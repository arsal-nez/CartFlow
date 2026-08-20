import { buildUpdateProductHandler } from '../../../src/handlers/products/update';
import { resetEnvConfig } from '../../../src/config/env';
import { NotFoundError } from '../../../src/errors/app-error';
import { createFakeProductService } from '../helpers/fake-product-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_PRODUCT = {
  productId: PRODUCT_ID,
  name: 'Trail Bottle',
  normalizedName: 'trail-bottle',
  description: 'Insulated bottle',
  categoryId: 'drinkware',
  status: 'ACTIVE' as const,
  priceCents: 1999,
  currency: 'USD',
  imageKeys: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
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

describe('PUT /api/v1/products/{id}', () => {
  it('updates the product for an admin caller', async () => {
    const fake = createFakeProductService();
    fake.updateProduct.mockResolvedValueOnce(SAMPLE_PRODUCT);
    const handler = buildUpdateProductHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { priceCents: 1999 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: SAMPLE_PRODUCT });
    expect(fake.updateProduct).toHaveBeenCalledWith(PRODUCT_ID, { priceCents: 1999 });
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeProductService();
    const handler = buildUpdateProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'PUT', pathParameters: { id: PRODUCT_ID }, body: { priceCents: 1999 } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(fake.updateProduct).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for a non-admin caller', async () => {
    const fake = createFakeProductService();
    const handler = buildUpdateProductHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { priceCents: 1999 },
        claims: { sub: 'user-1', 'cognito:groups': '["customer"]' },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(fake.updateProduct).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for an empty patch', async () => {
    const fake = createFakeProductService();
    const handler = buildUpdateProductHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: {},
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.updateProduct).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the product does not exist', async () => {
    const fake = createFakeProductService();
    fake.updateProduct.mockRejectedValueOnce(new NotFoundError(`Product ${PRODUCT_ID} not found`));
    const handler = buildUpdateProductHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { priceCents: 1999 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeProductService();
    fake.updateProduct.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildUpdateProductHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { priceCents: 1999 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
