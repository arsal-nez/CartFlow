import type { Product } from '../../src/domain/product';
import type { Inventory } from '../../src/domain/inventory';
import { InventoryUnavailableError } from '../../src/errors/app-error';
import { createCartService } from '../../src/services/cart.service';
import {
  createInMemoryCartRepository,
  createInMemoryInventoryRepository,
  createInMemoryProductRepository,
} from './helpers/in-memory-repositories';

/**
 * Race-prone scenarios against an in-memory model of the real DynamoDB
 * conditional-write semantics (see helpers/in-memory-repositories.ts). These
 * are integration tests in the sense that they exercise the full
 * service -> repository interaction under genuine interleaving, not mocked
 * call sequences — see docs/database.md, "Cart Concurrency And Consistency".
 */

const USER_ID = 'user-1';
const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    productId: id,
    name: `Product ${id}`,
    normalizedName: `product-${id}`,
    description: '',
    categoryId: 'general',
    status: 'ACTIVE',
    priceCents: 1000,
    currency: 'USD',
    imageKeys: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function inventory(id: string, availableQuantity: number): Inventory {
  return {
    productId: id,
    availableQuantity,
    reservedQuantity: 0,
    reorderThreshold: 1,
    stockStatus: 'IN_STOCK',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('concurrent cart mutations', () => {
  it('loses no updates when two requests add the same product to a brand-new cart at once', async () => {
    const service = createCartService({
      cartRepository: createInMemoryCartRepository(),
      productRepository: createInMemoryProductRepository([product(PRODUCT_A)]),
      inventoryRepository: createInMemoryInventoryRepository([inventory(PRODUCT_A, 100)]),
    });

    // Neither request has a cart to read yet — this also races the
    // conditional `createCart` header write, not just `updateCart`.
    const [first, second] = await Promise.all([
      service.addItem(USER_ID, PRODUCT_A, 3),
      service.addItem(USER_ID, PRODUCT_A, 4),
    ]);

    // Both calls succeed — neither throws, so nobody's "add to cart" click
    // silently fails. Whichever call's write lands first legitimately
    // reports only its own quantity at that instant (the other hasn't
    // committed yet); whichever loses the race retries, re-reads the
    // now-current cart, and reports the merged total. The invariant that
    // actually matters — no lost update — is the FINAL state below.
    expect([first.items[0]?.quantity, second.items[0]?.quantity]).toContain(7);

    const finalCart = await service.getCart(USER_ID);
    expect(finalCart.items).toHaveLength(1);
    expect(finalCart.items[0]?.quantity).toBe(7);
  });

  it('loses no updates when two requests add different products to the same cart at once', async () => {
    const service = createCartService({
      cartRepository: createInMemoryCartRepository(),
      productRepository: createInMemoryProductRepository([product(PRODUCT_A), product(PRODUCT_B)]),
      inventoryRepository: createInMemoryInventoryRepository([
        inventory(PRODUCT_A, 100),
        inventory(PRODUCT_B, 100),
      ]),
    });

    await Promise.all([
      service.addItem(USER_ID, PRODUCT_A, 2),
      service.addItem(USER_ID, PRODUCT_B, 5),
    ]);

    const finalCart = await service.getCart(USER_ID);
    const byProduct = new Map(finalCart.items.map((item) => [item.productId, item.quantity]));
    expect(byProduct.get(PRODUCT_A)).toBe(2);
    expect(byProduct.get(PRODUCT_B)).toBe(5);
    expect(finalCart.items).toHaveLength(2);
  });

  it('does not let two concurrent adds jointly exceed available stock', async () => {
    const service = createCartService({
      cartRepository: createInMemoryCartRepository(),
      productRepository: createInMemoryProductRepository([product(PRODUCT_A)]),
      inventoryRepository: createInMemoryInventoryRepository([inventory(PRODUCT_A, 5)]),
    });

    // Two requests each ask for 4 units of a product with only 5 in stock.
    // Whichever commits first brings the cart to 4/5; the other's retry
    // re-reads the cart, recomputes 4 (existing) + 4 (requested) = 8, and
    // is rejected against the 5-unit ceiling.
    const results = await Promise.allSettled([
      service.addItem(USER_ID, PRODUCT_A, 4),
      service.addItem(USER_ID, PRODUCT_A, 4),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InventoryUnavailableError);

    const finalCart = await service.getCart(USER_ID);
    expect(finalCart.items[0]?.quantity).toBeLessThanOrEqual(5);
  });

  it('does not lose a concurrent update to a different line during a remove', async () => {
    const cartRepository = createInMemoryCartRepository();
    const service = createCartService({
      cartRepository,
      productRepository: createInMemoryProductRepository([product(PRODUCT_A), product(PRODUCT_B)]),
      inventoryRepository: createInMemoryInventoryRepository([
        inventory(PRODUCT_A, 100),
        inventory(PRODUCT_B, 100),
      ]),
    });

    await service.addItem(USER_ID, PRODUCT_A, 1);
    await service.addItem(USER_ID, PRODUCT_B, 1);

    // One request removes product A while another concurrently raises
    // product B's quantity — neither write should clobber the other.
    await Promise.all([
      service.removeItem(USER_ID, PRODUCT_A),
      service.updateItemQuantity(USER_ID, PRODUCT_B, 9),
    ]);

    const finalCart = await service.getCart(USER_ID);
    expect(finalCart.items).toEqual([
      expect.objectContaining({ productId: PRODUCT_B, quantity: 9 }),
    ]);
  });
});
