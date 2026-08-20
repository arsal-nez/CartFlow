import { buildGetProductInventoryHandler } from '../../../src/handlers/products/get-inventory';
import type { InventoryService } from '../../../src/services/inventory.service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function createFakeService(): { service: InventoryService; getPublicStock: jest.Mock } {
  const getPublicStock = jest.fn();
  return {
    service: { getPublicStock, getAdminStock: jest.fn(), updateStock: jest.fn() },
    getPublicStock,
  };
}

describe('GET /api/v1/products/{id}/inventory', () => {
  it('returns the public stock view on success, with no authentication required', async () => {
    const fake = createFakeService();
    fake.getPublicStock.mockResolvedValueOnce({
      productId: PRODUCT_ID,
      availableQuantity: 4,
      stockStatus: 'LOW',
    });
    const handler = buildGetProductInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({
        pathParameters: { id: PRODUCT_ID },
        path: `/api/v1/products/${PRODUCT_ID}/inventory`,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({
      ok: true,
      data: { productId: PRODUCT_ID, availableQuantity: 4, stockStatus: 'LOW' },
    });
    expect(fake.getPublicStock).toHaveBeenCalledWith(PRODUCT_ID);
  });

  it('returns 400 VALIDATION_ERROR for a malformed id', async () => {
    const fake = createFakeService();
    const handler = buildGetProductInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({ pathParameters: { id: 'not-a-uuid' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(fake.getPublicStock).not.toHaveBeenCalled();
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeService();
    fake.getPublicStock.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildGetProductInventoryHandler(fake.service);

    const result = await handler(
      buildEvent({ pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
