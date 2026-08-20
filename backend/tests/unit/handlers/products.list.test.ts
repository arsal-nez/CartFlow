import { buildListProductsHandler } from '../../../src/handlers/products/list';
import { createFakeProductService } from '../helpers/fake-product-service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const SAMPLE_PRODUCT = {
  productId: '11111111-1111-4111-8111-111111111111',
  name: 'Trail Bottle',
  normalizedName: 'trail-bottle',
  description: 'Insulated bottle',
  categoryId: 'drinkware',
  status: 'ACTIVE' as const,
  priceCents: 2499,
  currency: 'USD',
  imageKeys: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('GET /api/v1/products', () => {
  it('returns a paginated list on success', async () => {
    const fake = createFakeProductService();
    fake.listProducts.mockResolvedValueOnce({ items: [SAMPLE_PRODUCT], cursor: 'next-cursor' });
    const handler = buildListProductsHandler(fake.service);

    const result = await handler(
      buildEvent({ queryStringParameters: { categoryId: 'drinkware' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body).toMatchObject({
      ok: true,
      data: [SAMPLE_PRODUCT],
      page: { nextCursor: 'next-cursor', limit: 20 },
    });
    expect(body.requestId).toBeDefined();
    expect(fake.listProducts).toHaveBeenCalledWith({ categoryId: 'drinkware' });
  });

  it('returns 400 VALIDATION_ERROR for a limit above the server cap', async () => {
    const fake = createFakeProductService();
    const handler = buildListProductsHandler(fake.service);

    const result = await handler(
      buildEvent({ queryStringParameters: { limit: '5000' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.listProducts).not.toHaveBeenCalled();
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeProductService();
    fake.listProducts.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildListProductsHandler(fake.service);

    const result = await handler(buildEvent(), fakeLambdaContext);

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });

  it('is reachable without authentication (public catalog route)', async () => {
    const fake = createFakeProductService();
    fake.listProducts.mockResolvedValueOnce({ items: [], cursor: null });
    const handler = buildListProductsHandler(fake.service);

    const result = await handler(buildEvent(), fakeLambdaContext);

    expect(result.statusCode).toBe(200);
  });
});
