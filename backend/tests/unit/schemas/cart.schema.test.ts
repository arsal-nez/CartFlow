import {
  addCartItemBodySchema,
  cartItemProductIdPathSchema,
  updateCartItemBodySchema,
} from '../../../src/schemas/cart.schema';

const VALID_PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

describe('cartItemProductIdPathSchema', () => {
  it('accepts a UUID productId', () => {
    expect(cartItemProductIdPathSchema.safeParse({ productId: VALID_PRODUCT_ID }).success).toBe(
      true,
    );
  });

  it('rejects a non-UUID productId', () => {
    expect(cartItemProductIdPathSchema.safeParse({ productId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a missing productId', () => {
    expect(cartItemProductIdPathSchema.safeParse({}).success).toBe(false);
  });
});

describe('addCartItemBodySchema', () => {
  it('accepts a valid body', () => {
    const result = addCartItemBodySchema.safeParse({ productId: VALID_PRODUCT_ID, quantity: 2 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ productId: VALID_PRODUCT_ID, quantity: 2 });
    }
  });

  it('has no field for a client-supplied userId or price — unknown keys are simply dropped', () => {
    const result = addCartItemBodySchema.safeParse({
      productId: VALID_PRODUCT_ID,
      quantity: 1,
      userId: 'attacker-supplied-id',
      priceCents: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('userId');
      expect(result.data).not.toHaveProperty('priceCents');
    }
  });

  it('rejects a missing productId', () => {
    expect(addCartItemBodySchema.safeParse({ quantity: 1 }).success).toBe(false);
  });

  it('rejects a non-UUID productId', () => {
    expect(addCartItemBodySchema.safeParse({ productId: 'abc', quantity: 1 }).success).toBe(false);
  });

  it.each([0, -1, 1.5, undefined])('rejects an invalid quantity (%p)', (quantity) => {
    expect(addCartItemBodySchema.safeParse({ productId: VALID_PRODUCT_ID, quantity }).success).toBe(
      false,
    );
  });

  it('rejects a quantity above the retail ceiling', () => {
    expect(
      addCartItemBodySchema.safeParse({ productId: VALID_PRODUCT_ID, quantity: 1_000_000 }).success,
    ).toBe(false);
  });

  it('rejects a non-numeric quantity', () => {
    expect(
      addCartItemBodySchema.safeParse({ productId: VALID_PRODUCT_ID, quantity: '2' }).success,
    ).toBe(false);
  });
});

describe('updateCartItemBodySchema', () => {
  it('accepts a valid quantity', () => {
    expect(updateCartItemBodySchema.safeParse({ quantity: 5 }).success).toBe(true);
  });

  it('rejects zero — use DELETE to remove a line, not a zero quantity', () => {
    expect(updateCartItemBodySchema.safeParse({ quantity: 0 }).success).toBe(false);
  });

  it('rejects a negative quantity', () => {
    expect(updateCartItemBodySchema.safeParse({ quantity: -3 }).success).toBe(false);
  });

  it('rejects a missing quantity', () => {
    expect(updateCartItemBodySchema.safeParse({}).success).toBe(false);
  });
});
