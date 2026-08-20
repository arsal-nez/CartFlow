import { buildGetProductHandler } from '../../../src/handlers/products/get';
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
  priceCents: 2499,
  currency: 'USD',
  imageKeys: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('GET /api/v1/products/{id}', () => {
  it('returns the product on success', async () => {
    const fake = createFakeProductService();
    fake.getProduct.mockResolvedValueOnce(SAMPLE_PRODUCT);
    const handler = buildGetProductHandler(fake.service);

    const result = await handler(
      buildEvent({ pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: SAMPLE_PRODUCT });
    expect(fake.getProduct).toHaveBeenCalledWith(PRODUCT_ID);
  });

  it('returns 400 VALIDATION_ERROR for a malformed id', async () => {
    const fake = createFakeProductService();
    const handler = buildGetProductHandler(fake.service);

    const result = await handler(
      buildEvent({ pathParameters: { id: 'not-a-uuid' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.getProduct).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the product does not exist', async () => {
    const fake = createFakeProductService();
    fake.getProduct.mockRejectedValueOnce(new NotFoundError(`Product ${PRODUCT_ID} not found`));
    const handler = buildGetProductHandler(fake.service);

    const result = await handler(
      buildEvent({ pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeProductService();
    fake.getProduct.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));
    const handler = buildGetProductHandler(fake.service);

    const result = await handler(
      buildEvent({ pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
