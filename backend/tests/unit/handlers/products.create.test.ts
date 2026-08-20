import { buildCreateProductHandler } from '../../../src/handlers/products/create';
import { resetEnvConfig } from '../../../src/config/env';
import { ConflictError } from '../../../src/errors/app-error';
import { createFakeProductService } from '../helpers/fake-product-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_PRODUCT = {
  productId: PRODUCT_ID,
  name: 'Trail Bottle',
  normalizedName: 'trail-bottle',
  description: 'Insulated bottle',
  categoryId: 'drinkware',
  status: 'DRAFT' as const,
  priceCents: 2499,
  currency: 'USD',
  imageKeys: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const VALID_BODY = {
  name: 'Trail Bottle',
  description: 'Insulated bottle',
  categoryId: 'drinkware',
  priceCents: 2499,
  currency: 'USD',
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

describe('POST /api/v1/products', () => {
  it('creates the product and returns 201 for an admin caller', async () => {
    const fake = createFakeProductService();
    fake.createProduct.mockResolvedValueOnce(SAMPLE_PRODUCT);
    const handler = buildCreateProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'POST', body: VALID_BODY, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(201);
    expect(parseBody(result)).toMatchObject({ ok: true, data: SAMPLE_PRODUCT });
    expect(fake.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Trail Bottle' }),
    );
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeProductService();
    const handler = buildCreateProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'POST', body: VALID_BODY }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(parseBody(result).error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fake.createProduct).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for an authenticated non-admin caller', async () => {
    const fake = createFakeProductService();
    const handler = buildCreateProductHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        body: VALID_BODY,
        claims: { sub: 'user-1', 'cognito:groups': '["customer"]' },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(parseBody(result).error).toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.createProduct).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for an invalid body, without calling the service', async () => {
    const fake = createFakeProductService();
    const handler = buildCreateProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'POST', body: { ...VALID_BODY, name: '' }, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.createProduct).not.toHaveBeenCalled();
  });

  it('checks authorization before request validation', async () => {
    const fake = createFakeProductService();
    const handler = buildCreateProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'POST', body: { name: '' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
  });

  it('returns 409 CONFLICT when the product already exists (duplicate product)', async () => {
    const fake = createFakeProductService();
    fake.createProduct.mockRejectedValueOnce(
      new ConflictError(`Product ${PRODUCT_ID} already exists`),
    );
    const handler = buildCreateProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'POST', body: VALID_BODY, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).error).toMatchObject({ code: 'CONFLICT' });
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeProductService();
    fake.createProduct.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildCreateProductHandler(fake.service);

    const result = await handler(
      buildEvent({ method: 'POST', body: VALID_BODY, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
