import { buildAdminGetInventoryHandler } from '../../../src/handlers/inventory/admin-get';
import type { InventoryService } from '../../../src/services/inventory.service';
import { resetEnvConfig } from '../../../src/config/env';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
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

function createFakeService(): { service: InventoryService; getAdminStock: jest.Mock } {
  const getAdminStock = jest.fn();
  return {
    service: { getPublicStock: jest.fn(), getAdminStock, updateStock: jest.fn() },
    getAdminStock,
  };
}

describe('GET /api/v1/admin/inventory/{id}', () => {
  it('returns the full admin stock view for an admin caller', async () => {
    const fake = createFakeService();
    fake.getAdminStock.mockResolvedValueOnce({
      productId: PRODUCT_ID,
      availableQuantity: 4,
      reservedQuantity: 1,
      reorderThreshold: 5,
      stockStatus: 'LOW',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const handler = buildAdminGetInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({ pathParameters: { id: PRODUCT_ID }, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({
      ok: true,
      data: { productId: PRODUCT_ID, reservedQuantity: 1, reorderThreshold: 5 },
    });
    expect(fake.getAdminStock).toHaveBeenCalledWith(PRODUCT_ID);
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeService();
    const handler = buildAdminGetInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({ pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(fake.getAdminStock).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for a non-admin caller', async () => {
    const fake = createFakeService();
    const handler = buildAdminGetInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({
        pathParameters: { id: PRODUCT_ID },
        claims: { sub: 'user-1', 'cognito:groups': '["customer"]' },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(fake.getAdminStock).not.toHaveBeenCalled();
  });
});
