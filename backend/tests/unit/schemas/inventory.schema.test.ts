import {
  productIdPathSchema,
  updateInventoryBodySchema,
} from '../../../src/schemas/inventory.schema';

describe('productIdPathSchema (re-exported for the admin inventory routes)', () => {
  it('accepts a UUID', () => {
    expect(
      productIdPathSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111' }).success,
    ).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    expect(productIdPathSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('updateInventoryBodySchema', () => {
  it('accepts availableQuantity alone', () => {
    const result = updateInventoryBodySchema.safeParse({ availableQuantity: 10 });
    expect(result.success).toBe(true);
  });

  it('accepts reorderThreshold alone', () => {
    expect(updateInventoryBodySchema.safeParse({ reorderThreshold: 2 }).success).toBe(true);
  });

  it('accepts both together, plus an optimistic-concurrency guard', () => {
    const result = updateInventoryBodySchema.safeParse({
      availableQuantity: 10,
      reorderThreshold: 2,
      expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty body — at least one field is required', () => {
    expect(updateInventoryBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a negative availableQuantity', () => {
    expect(updateInventoryBodySchema.safeParse({ availableQuantity: -1 }).success).toBe(false);
  });

  it('accepts zero — a product can legitimately be set out of stock', () => {
    // Zero is a valid absolute stock count here, unlike cart quantity where
    // zero means "remove the line instead" (see cart.schema.test.ts).
    // Documented explicitly so the distinction isn't just "whatever the
    // regex happens to allow".
    expect(updateInventoryBodySchema.safeParse({ availableQuantity: 0 }).success).toBe(true);
  });

  it('rejects a negative reorderThreshold', () => {
    expect(updateInventoryBodySchema.safeParse({ reorderThreshold: -5 }).success).toBe(false);
  });

  it('rejects a non-integer availableQuantity', () => {
    expect(updateInventoryBodySchema.safeParse({ availableQuantity: 4.5 }).success).toBe(false);
  });

  it('rejects a non-numeric availableQuantity', () => {
    expect(updateInventoryBodySchema.safeParse({ availableQuantity: '10' }).success).toBe(false);
  });

  it('rejects an empty expectedUpdatedAt string', () => {
    expect(
      updateInventoryBodySchema.safeParse({ availableQuantity: 1, expectedUpdatedAt: '' }).success,
    ).toBe(false);
  });
});
