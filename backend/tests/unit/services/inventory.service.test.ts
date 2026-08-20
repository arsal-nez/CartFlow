import type { InventoryRepository } from '../../../src/repositories/inventory.repository';
import { createInventoryService } from '../../../src/services/inventory.service';

function createFakeRepository(): jest.Mocked<InventoryRepository> {
  return { getInventory: jest.fn(), updateInventory: jest.fn() };
}

describe('getPublicStock', () => {
  it('projects only the public-safe fields from the inventory record', async () => {
    const repository = createFakeRepository();
    repository.getInventory.mockResolvedValueOnce({
      productId: 'p-1',
      availableQuantity: 12,
      reservedQuantity: 3,
      reorderThreshold: 5,
      stockStatus: 'IN_STOCK',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const service = createInventoryService({ repository });

    const stock = await service.getPublicStock('p-1');

    expect(stock).toEqual({ productId: 'p-1', availableQuantity: 12, stockStatus: 'IN_STOCK' });
    expect(stock).not.toHaveProperty('reservedQuantity');
    expect(stock).not.toHaveProperty('reorderThreshold');
  });

  it('does not use a consistent read — this is a display-only endpoint, not a purchase decision', async () => {
    const repository = createFakeRepository();
    repository.getInventory.mockResolvedValueOnce({
      productId: 'p-1',
      availableQuantity: 1,
      reservedQuantity: 0,
      reorderThreshold: 1,
      stockStatus: 'LOW',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const service = createInventoryService({ repository });

    await service.getPublicStock('p-1');

    expect(repository.getInventory).toHaveBeenCalledWith('p-1');
  });

  it('reports zero/out-of-stock, not an error, when no inventory record exists yet', async () => {
    const repository = createFakeRepository();
    repository.getInventory.mockResolvedValueOnce(null);
    const service = createInventoryService({ repository });

    const stock = await service.getPublicStock('never-stocked');

    expect(stock).toEqual({
      productId: 'never-stocked',
      availableQuantity: 0,
      stockStatus: 'OUT_OF_STOCK',
    });
  });
});

describe('getAdminStock', () => {
  it('projects the full record, including reservedQuantity and reorderThreshold', async () => {
    const repository = createFakeRepository();
    repository.getInventory.mockResolvedValueOnce({
      productId: 'p-1',
      availableQuantity: 4,
      reservedQuantity: 1,
      reorderThreshold: 5,
      stockStatus: 'LOW',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const service = createInventoryService({ repository });

    const stock = await service.getAdminStock('p-1');

    expect(stock).toEqual({
      productId: 'p-1',
      availableQuantity: 4,
      reservedQuantity: 1,
      reorderThreshold: 5,
      stockStatus: 'LOW',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(repository.getInventory).toHaveBeenCalledWith('p-1', { consistentRead: true });
  });

  it('reports zero counters and a null updatedAt when never stocked', async () => {
    const repository = createFakeRepository();
    repository.getInventory.mockResolvedValueOnce(null);
    const service = createInventoryService({ repository });

    const stock = await service.getAdminStock('never-stocked');

    expect(stock).toEqual({
      productId: 'never-stocked',
      availableQuantity: 0,
      reservedQuantity: 0,
      reorderThreshold: 0,
      stockStatus: 'OUT_OF_STOCK',
      updatedAt: null,
    });
  });
});

describe('updateStock', () => {
  it('passes absolute values through to the repository and projects the result', async () => {
    const repository = createFakeRepository();
    repository.updateInventory.mockResolvedValueOnce({
      productId: 'p-1',
      availableQuantity: 20,
      reservedQuantity: 0,
      reorderThreshold: 5,
      stockStatus: 'IN_STOCK',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    const service = createInventoryService({ repository });

    const stock = await service.updateStock('p-1', { availableQuantity: 20 });

    expect(repository.updateInventory).toHaveBeenCalledWith('p-1', { availableQuantity: 20 });
    expect(stock).toEqual({
      productId: 'p-1',
      availableQuantity: 20,
      reservedQuantity: 0,
      reorderThreshold: 5,
      stockStatus: 'IN_STOCK',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
  });

  it('forwards expectedUpdatedAt as an optimistic concurrency guard', async () => {
    const repository = createFakeRepository();
    repository.updateInventory.mockResolvedValueOnce({
      productId: 'p-1',
      availableQuantity: 5,
      reservedQuantity: 0,
      reorderThreshold: 2,
      stockStatus: 'IN_STOCK',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    const service = createInventoryService({ repository });

    await service.updateStock('p-1', {
      reorderThreshold: 2,
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(repository.updateInventory).toHaveBeenCalledWith('p-1', {
      reorderThreshold: 2,
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });
  });
});
