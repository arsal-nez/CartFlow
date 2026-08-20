import { buildAdminListProductsHandler } from '../../../src/handlers/products/admin-list';
import { resetEnvConfig } from '../../../src/config/env';
import { createFakeProductService } from '../helpers/fake-product-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const SAMPLE_PRODUCT = {
  productId: '11111111-1111-4111-8111-111111111111',
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

describe('GET /api/v1/admin/products', () => {
  it('lists products in the requested status for an admin caller', async () => {
    const fake = createFakeProductService();
    fake.listProducts.mockResolvedValueOnce({ items: [SAMPLE_PRODUCT], cursor: null });
    const handler = buildAdminListProductsHandler(fake.service);

    const result = await handler(
      buildEvent({ queryStringParameters: { status: 'DRAFT' }, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: [SAMPLE_PRODUCT] });
    expect(fake.listProducts).toHaveBeenCalledWith({ status: 'DRAFT' });
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeProductService();
    const handler = buildAdminListProductsHandler(fake.service);

    const result = await handler(buildEvent(), fakeLambdaContext);

    expect(result.statusCode).toBe(401);
    expect(fake.listProducts).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for an authenticated non-admin caller', async () => {
    const fake = createFakeProductService();
    const handler = buildAdminListProductsHandler(fake.service);

    const result = await handler(
      buildEvent({ claims: { sub: 'user-1', 'cognito:groups': '["customer"]' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(fake.listProducts).not.toHaveBeenCalled();
  });

  it('rejects a status value outside the known enum', async () => {
    const fake = createFakeProductService();
    const handler = buildAdminListProductsHandler(fake.service);

    const result = await handler(
      buildEvent({ queryStringParameters: { status: 'DELETED' }, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(fake.listProducts).not.toHaveBeenCalled();
  });
});
