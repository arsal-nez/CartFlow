import { NotFoundError } from '../../../src/errors/app-error';
import type { ProductRepository } from '../../../src/repositories/product.repository';
import { createProductService } from '../../../src/services/product.service';

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

function createFakeRepository(): jest.Mocked<ProductRepository> {
  return {
    create: jest.fn(),
    getById: jest.fn(),
    list: jest.fn(),
    listByCategory: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    delete: jest.fn(),
  };
}

describe('listProducts', () => {
  it('delegates to list() when no categoryId is given', async () => {
    const repository = createFakeRepository();
    repository.list.mockResolvedValueOnce({ items: [SAMPLE_PRODUCT], cursor: null });
    const service = createProductService({ repository });

    const page = await service.listProducts({ limit: 10 });

    expect(repository.list).toHaveBeenCalledWith({ limit: 10 });
    expect(repository.listByCategory).not.toHaveBeenCalled();
    expect(page.items).toEqual([SAMPLE_PRODUCT]);
  });

  it('delegates to listByCategory() when categoryId is given', async () => {
    const repository = createFakeRepository();
    repository.listByCategory.mockResolvedValueOnce({ items: [], cursor: null });
    const service = createProductService({ repository });

    await service.listProducts({ categoryId: 'drinkware', cursor: 'abc' });

    expect(repository.listByCategory).toHaveBeenCalledWith({
      categoryId: 'drinkware',
      cursor: 'abc',
    });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('omits limit and cursor entirely when not provided', async () => {
    const repository = createFakeRepository();
    repository.list.mockResolvedValueOnce({ items: [], cursor: null });
    const service = createProductService({ repository });

    await service.listProducts({});

    expect(repository.list).toHaveBeenCalledWith({});
  });
});

describe('getProduct', () => {
  it('returns the product when it exists', async () => {
    const repository = createFakeRepository();
    repository.getById.mockResolvedValueOnce(SAMPLE_PRODUCT);
    const service = createProductService({ repository });

    await expect(service.getProduct(SAMPLE_PRODUCT.productId)).resolves.toEqual(SAMPLE_PRODUCT);
  });

  it('raises NotFoundError when the repository returns null', async () => {
    const repository = createFakeRepository();
    repository.getById.mockResolvedValueOnce(null);
    const service = createProductService({ repository });

    await expect(service.getProduct('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('createProduct', () => {
  it('generates the productId server-side and forwards a full create input', async () => {
    const repository = createFakeRepository();
    repository.create.mockResolvedValueOnce(SAMPLE_PRODUCT);
    const service = createProductService({ repository, idGenerator: () => 'generated-id' });

    await service.createProduct({
      name: 'Trail Bottle',
      description: 'Insulated bottle',
      categoryId: 'drinkware',
      priceCents: 2499,
      currency: 'USD',
    });

    expect(repository.create).toHaveBeenCalledWith({
      productId: 'generated-id',
      name: 'Trail Bottle',
      description: 'Insulated bottle',
      categoryId: 'drinkware',
      priceCents: 2499,
      currency: 'USD',
    });
  });

  it('forwards an explicit status when supplied', async () => {
    const repository = createFakeRepository();
    repository.create.mockResolvedValueOnce(SAMPLE_PRODUCT);
    const service = createProductService({ repository, idGenerator: () => 'generated-id' });

    await service.createProduct({
      name: 'Trail Bottle',
      description: '',
      categoryId: 'drinkware',
      priceCents: 2499,
      currency: 'USD',
      status: 'ACTIVE',
    });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
  });

  it('propagates a repository conflict for a duplicate product', async () => {
    const repository = createFakeRepository();
    const { ConflictError } = await import('../../../src/errors/app-error');
    repository.create.mockRejectedValueOnce(
      new ConflictError('Product generated-id already exists'),
    );
    const service = createProductService({ repository, idGenerator: () => 'generated-id' });

    await expect(
      service.createProduct({
        name: 'Trail Bottle',
        description: '',
        categoryId: 'drinkware',
        priceCents: 2499,
        currency: 'USD',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('updateProduct', () => {
  it('forwards only the fields that were supplied', async () => {
    const repository = createFakeRepository();
    repository.update.mockResolvedValueOnce(SAMPLE_PRODUCT);
    const service = createProductService({ repository });

    await service.updateProduct(SAMPLE_PRODUCT.productId, { priceCents: 1999 });

    expect(repository.update).toHaveBeenCalledWith(SAMPLE_PRODUCT.productId, { priceCents: 1999 });
  });
});

describe('deleteProduct', () => {
  it('deactivates rather than hard-deletes', async () => {
    const repository = createFakeRepository();
    repository.deactivate.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, status: 'ARCHIVED' });
    const service = createProductService({ repository });

    const product = await service.deleteProduct(SAMPLE_PRODUCT.productId);

    expect(repository.deactivate).toHaveBeenCalledWith(SAMPLE_PRODUCT.productId);
    expect(repository.delete).not.toHaveBeenCalled();
    expect(product.status).toBe('ARCHIVED');
  });
});
