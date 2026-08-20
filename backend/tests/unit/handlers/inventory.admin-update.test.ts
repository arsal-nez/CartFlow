import { buildAdminUpdateInventoryHandler } from '../../../src/handlers/inventory/admin-update';
import type { InventoryService } from '../../../src/services/inventory.service';
import { ConflictError } from '../../../src/errors/app-error';
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

function createFakeService(): { service: InventoryService; updateStock: jest.Mock } {
  const updateStock = jest.fn();
  return {
    service: { getPublicStock: jest.fn(), getAdminStock: jest.fn(), updateStock },
    updateStock,
  };
}

describe('PUT /api/v1/admin/inventory/{id}', () => {
  it('updates stock for an admin caller', async () => {
    const fake = createFakeService();
    fake.updateStock.mockResolvedValueOnce({
      productId: PRODUCT_ID,
      availableQuantity: 20,
      reservedQuantity: 0,
      reorderThreshold: 5,
      stockStatus: 'IN_STOCK',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const handler = buildAdminUpdateInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { availableQuantity: 20 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: { availableQuantity: 20 } });
    expect(fake.updateStock).toHaveBeenCalledWith(PRODUCT_ID, { availableQuantity: 20 });
  });

  it('returns 400 VALIDATION_ERROR when neither field is provided', async () => {
    const fake = createFakeService();
    const handler = buildAdminUpdateInventoryHandler(fake.service);

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
    expect(fake.updateStock).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for a non-admin caller', async () => {
    const fake = createFakeService();
    const handler = buildAdminUpdateInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { availableQuantity: 20 },
        claims: { sub: 'user-1', 'cognito:groups': '["customer"]' },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(fake.updateStock).not.toHaveBeenCalled();
  });

  it('returns 409 CONFLICT on a concurrent modification', async () => {
    const fake = createFakeService();
    fake.updateStock.mockRejectedValueOnce(new ConflictError('stale'));
    const handler = buildAdminUpdateInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { availableQuantity: 20, expectedUpdatedAt: 'stale-timestamp' },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(409);
  });
});
