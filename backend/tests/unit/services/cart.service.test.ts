import type { Cart } from '../../../src/domain/cart';
import type { Inventory } from '../../../src/domain/inventory';
import type { Product } from '../../../src/domain/product';
import {
  ConflictError,
  InventoryUnavailableError,
  NotFoundError,
  ValidationError,
} from '../../../src/errors/app-error';
import type { CartRepository } from '../../../src/repositories/cart.repository';
import type { InventoryRepository } from '../../../src/repositories/inventory.repository';
import type { ProductRepository } from '../../../src/repositories/product.repository';
import { createCartService } from '../../../src/services/cart.service';

const USER_ID = 'user-1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function activeProduct(overrides: Partial<Product> = {}): Product {
  return {
    productId: PRODUCT_ID,
    name: 'Trail Bottle',
    normalizedName: 'trail-bottle',
    description: 'Insulated bottle',
    categoryId: 'drinkware',
    status: 'ACTIVE',
    priceCents: 2499,
    currency: 'USD',
    imageKeys: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function inventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    productId: PRODUCT_ID,
    availableQuantity: 10,
    reservedQuantity: 0,
    reorderThreshold: 2,
    stockStatus: 'IN_STOCK',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function emptyCart(overrides: Partial<Cart> = {}): Cart {
  return {
    userId: USER_ID,
    currency: 'USD',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    items: [],
    ...overrides,
  };
}

function createFakeRepositories() {
  const cartRepository: jest.Mocked<CartRepository> = {
    getCart: jest.fn(),
    createCart: jest.fn(),
    updateCart: jest.fn(),
  };
  const productRepository: jest.Mocked<ProductRepository> = {
    create: jest.fn(),
    getById: jest.fn(),
    list: jest.fn(),
    listByCategory: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    delete: jest.fn(),
  };
  const inventoryRepository: jest.Mocked<InventoryRepository> = {
    getInventory: jest.fn(),
    updateInventory: jest.fn(),
  };
  return { cartRepository, productRepository, inventoryRepository };
}

function createService(overrides: Partial<ReturnType<typeof createFakeRepositories>> = {}) {
  const repos = createFakeRepositories();
  Object.assign(repos, overrides);
  const service = createCartService({
    cartRepository: repos.cartRepository,
    productRepository: repos.productRepository,
    inventoryRepository: repos.inventoryRepository,
  });
  return { service, ...repos };
}

describe('getCart', () => {
  it('returns an empty view when the user has no cart yet', async () => {
    const { service, cartRepository } = createService();
    cartRepository.getCart.mockResolvedValueOnce(null);

    const view = await service.getCart(USER_ID);

    expect(view).toEqual({
      userId: USER_ID,
      currency: 'USD',
      items: [],
      subtotalCents: 0,
      updatedAt: null,
    });
  });

  it('hydrates name, price, and a server-computed subtotal from current product records', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    cartRepository.getCart.mockResolvedValueOnce(
      emptyCart({
        items: [
          { userId: USER_ID, productId: PRODUCT_ID, quantity: 3, createdAt: 'x', updatedAt: 'x' },
        ],
      }),
    );
    productRepository.getById.mockResolvedValueOnce(activeProduct({ priceCents: 500 }));
    inventoryRepository.getInventory.mockResolvedValueOnce(inventory({ availableQuantity: 7 }));

    const view = await service.getCart(USER_ID);

    expect(view.items).toEqual([
      {
        productId: PRODUCT_ID,
        name: 'Trail Bottle',
        priceCents: 500,
        currency: 'USD',
        quantity: 3,
        lineTotalCents: 1500,
        productAvailable: true,
        availableQuantity: 7,
      },
    ]);
    expect(view.subtotalCents).toBe(1500);
  });

  it('excludes a line whose product was hard-deleted since it was added', async () => {
    const { service, cartRepository, productRepository } = createService();
    cartRepository.getCart.mockResolvedValueOnce(
      emptyCart({
        items: [
          { userId: USER_ID, productId: PRODUCT_ID, quantity: 1, createdAt: 'x', updatedAt: 'x' },
        ],
      }),
    );
    productRepository.getById.mockResolvedValueOnce(null);

    const view = await service.getCart(USER_ID);

    expect(view.items).toEqual([]);
    expect(view.subtotalCents).toBe(0);
  });

  it('keeps a line for an archived product visible but excludes it from the subtotal', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    cartRepository.getCart.mockResolvedValueOnce(
      emptyCart({
        items: [
          { userId: USER_ID, productId: PRODUCT_ID, quantity: 2, createdAt: 'x', updatedAt: 'x' },
        ],
      }),
    );
    productRepository.getById.mockResolvedValueOnce(
      activeProduct({ status: 'ARCHIVED', priceCents: 500 }),
    );
    inventoryRepository.getInventory.mockResolvedValueOnce(inventory());

    const view = await service.getCart(USER_ID);

    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ productAvailable: false, lineTotalCents: 0 });
    expect(view.subtotalCents).toBe(0);
  });
});

describe('addItem', () => {
  it('creates a new line and returns the server-computed subtotal', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    productRepository.getById.mockResolvedValue(activeProduct({ priceCents: 1000 }));
    inventoryRepository.getInventory.mockResolvedValue(inventory({ availableQuantity: 5 }));
    cartRepository.getCart.mockResolvedValueOnce(null); // ensureCart: no cart yet
    cartRepository.createCart.mockResolvedValueOnce(emptyCart());
    cartRepository.updateCart.mockResolvedValueOnce(
      emptyCart({
        updatedAt: 'y',
        items: [
          { userId: USER_ID, productId: PRODUCT_ID, quantity: 2, createdAt: 'x', updatedAt: 'y' },
        ],
      }),
    );

    const view = await service.addItem(USER_ID, PRODUCT_ID, 2);

    expect(cartRepository.createCart).toHaveBeenCalledWith({ userId: USER_ID });
    expect(cartRepository.updateCart).toHaveBeenCalledWith({
      userId: USER_ID,
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
      expectedUpdatedAt: expect.any(String),
    });
    expect(view.subtotalCents).toBe(2000);
  });

  it('increments an existing line rather than overwriting it', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    productRepository.getById.mockResolvedValue(activeProduct({ priceCents: 100 }));
    inventoryRepository.getInventory.mockResolvedValue(inventory({ availableQuantity: 50 }));
    const cartWithLine = emptyCart({
      items: [
        { userId: USER_ID, productId: PRODUCT_ID, quantity: 3, createdAt: 'x', updatedAt: 'x' },
      ],
    });
    cartRepository.getCart.mockResolvedValueOnce(cartWithLine);
    cartRepository.updateCart.mockResolvedValueOnce({
      ...cartWithLine,
      items: [
        { userId: USER_ID, productId: PRODUCT_ID, quantity: 5, createdAt: 'x', updatedAt: 'z' },
      ],
    });

    await service.addItem(USER_ID, PRODUCT_ID, 2);

    expect(cartRepository.updateCart).toHaveBeenCalledWith({
      userId: USER_ID,
      items: [{ productId: PRODUCT_ID, quantity: 5 }],
      expectedUpdatedAt: cartWithLine.updatedAt,
    });
  });

  it('rejects a nonexistent product', async () => {
    const { service, productRepository } = createService();
    productRepository.getById.mockResolvedValueOnce(null);

    await expect(service.addItem(USER_ID, PRODUCT_ID, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a non-ACTIVE product', async () => {
    const { service, productRepository } = createService();
    productRepository.getById.mockResolvedValueOnce(activeProduct({ status: 'DRAFT' }));

    await expect(service.addItem(USER_ID, PRODUCT_ID, 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it.each([0, -1, 1.5])('rejects a non-positive or non-integer quantity (%p)', async (quantity) => {
    const { service } = createService();
    await expect(service.addItem(USER_ID, PRODUCT_ID, quantity)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a quantity that exceeds available inventory', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    productRepository.getById.mockResolvedValueOnce(activeProduct());
    inventoryRepository.getInventory.mockResolvedValueOnce(inventory({ availableQuantity: 3 }));
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());

    await expect(service.addItem(USER_ID, PRODUCT_ID, 4)).rejects.toBeInstanceOf(
      InventoryUnavailableError,
    );
    expect(cartRepository.updateCart).not.toHaveBeenCalled();
  });

  it('treats a missing inventory record as zero available stock', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    productRepository.getById.mockResolvedValueOnce(activeProduct());
    inventoryRepository.getInventory.mockResolvedValueOnce(null);
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());

    await expect(service.addItem(USER_ID, PRODUCT_ID, 1)).rejects.toBeInstanceOf(
      InventoryUnavailableError,
    );
  });

  it('sums the existing line quantity into the inventory check, not just the new amount', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    productRepository.getById.mockResolvedValueOnce(activeProduct());
    inventoryRepository.getInventory.mockResolvedValueOnce(inventory({ availableQuantity: 5 }));
    cartRepository.getCart.mockResolvedValueOnce(
      emptyCart({
        items: [
          { userId: USER_ID, productId: PRODUCT_ID, quantity: 4, createdAt: 'x', updatedAt: 'x' },
        ],
      }),
    );

    // 4 already in cart + 2 more requested = 6, which exceeds the 5 available.
    await expect(service.addItem(USER_ID, PRODUCT_ID, 2)).rejects.toBeInstanceOf(
      InventoryUnavailableError,
    );
  });
});

describe('addItem — optimistic-concurrency retry', () => {
  it('re-reads and retries once on a lost update-cart race, then succeeds', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    productRepository.getById.mockResolvedValue(activeProduct());
    inventoryRepository.getInventory.mockResolvedValue(inventory({ availableQuantity: 50 }));
    cartRepository.getCart
      .mockResolvedValueOnce(emptyCart({ updatedAt: 'v1' }))
      .mockResolvedValueOnce(emptyCart({ updatedAt: 'v2' })); // re-read after the conflict
    cartRepository.updateCart
      .mockRejectedValueOnce(new ConflictError('Cart for user user-1 was modified concurrently'))
      .mockResolvedValueOnce(
        emptyCart({
          updatedAt: 'v3',
          items: [
            {
              userId: USER_ID,
              productId: PRODUCT_ID,
              quantity: 1,
              createdAt: 'x',
              updatedAt: 'v3',
            },
          ],
        }),
      );

    const view = await service.addItem(USER_ID, PRODUCT_ID, 1);

    expect(cartRepository.getCart).toHaveBeenCalledTimes(2);
    expect(cartRepository.updateCart).toHaveBeenCalledTimes(2);
    expect(cartRepository.updateCart).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ expectedUpdatedAt: 'v1' }),
    );
    expect(cartRepository.updateCart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedUpdatedAt: 'v2' }),
    );
    expect(view.items[0]?.quantity).toBe(1);
  });

  it('gives up and surfaces ConflictError once the retry budget is exhausted', async () => {
    const { cartRepository, productRepository, inventoryRepository } = createFakeRepositories();
    productRepository.getById.mockResolvedValue(activeProduct());
    inventoryRepository.getInventory.mockResolvedValue(inventory({ availableQuantity: 50 }));
    cartRepository.getCart.mockResolvedValue(emptyCart());
    cartRepository.updateCart.mockRejectedValue(new ConflictError('always conflicts'));

    const service = createCartService({
      cartRepository,
      productRepository,
      inventoryRepository,
      maxConflictRetries: 3,
    });

    await expect(service.addItem(USER_ID, PRODUCT_ID, 1)).rejects.toBeInstanceOf(ConflictError);
    expect(cartRepository.updateCart).toHaveBeenCalledTimes(3);
  });

  it('swallows the ConflictError from a lost cart-creation race and proceeds', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    productRepository.getById.mockResolvedValue(activeProduct());
    inventoryRepository.getInventory.mockResolvedValue(inventory({ availableQuantity: 50 }));
    cartRepository.getCart
      .mockResolvedValueOnce(null) // ensureCart's first read: no cart
      .mockResolvedValueOnce(emptyCart({ updatedAt: 'created-by-other-request' })); // re-read after the race
    cartRepository.createCart.mockRejectedValueOnce(
      new ConflictError('Cart for user user-1 already exists'),
    );
    cartRepository.updateCart.mockResolvedValueOnce(
      emptyCart({
        items: [
          { userId: USER_ID, productId: PRODUCT_ID, quantity: 1, createdAt: 'x', updatedAt: 'z' },
        ],
      }),
    );

    const view = await service.addItem(USER_ID, PRODUCT_ID, 1);

    expect(view.items[0]?.quantity).toBe(1);
    expect(cartRepository.updateCart).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: 'created-by-other-request' }),
    );
  });
});

describe('updateItemQuantity', () => {
  it('sets an existing line to the absolute quantity', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    // getById is called once for the requireActiveProduct check and again
    // per line during response hydration, so it must stay sticky here.
    productRepository.getById.mockResolvedValue(activeProduct());
    inventoryRepository.getInventory.mockResolvedValue(inventory({ availableQuantity: 20 }));
    const cart = emptyCart({
      items: [
        { userId: USER_ID, productId: PRODUCT_ID, quantity: 1, createdAt: 'x', updatedAt: 'x' },
        {
          userId: USER_ID,
          productId: OTHER_PRODUCT_ID,
          quantity: 9,
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
    });
    cartRepository.getCart.mockResolvedValueOnce(cart);
    cartRepository.updateCart.mockResolvedValueOnce({
      ...cart,
      items: cart.items.map((item) =>
        item.productId === PRODUCT_ID ? { ...item, quantity: 7 } : item,
      ),
    });

    await service.updateItemQuantity(USER_ID, PRODUCT_ID, 7);

    expect(cartRepository.updateCart).toHaveBeenCalledWith({
      userId: USER_ID,
      items: [
        { productId: PRODUCT_ID, quantity: 7 },
        { productId: OTHER_PRODUCT_ID, quantity: 9 },
      ],
      expectedUpdatedAt: cart.updatedAt,
    });
  });

  it('404s when the product is not already in the cart', async () => {
    const { service, cartRepository, productRepository } = createService();
    productRepository.getById.mockResolvedValueOnce(activeProduct());
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());

    await expect(service.updateItemQuantity(USER_ID, PRODUCT_ID, 2)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('404s when the cart does not exist at all', async () => {
    const { service, cartRepository, productRepository } = createService();
    productRepository.getById.mockResolvedValueOnce(activeProduct());
    cartRepository.getCart.mockResolvedValueOnce(null);

    await expect(service.updateItemQuantity(USER_ID, PRODUCT_ID, 2)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects raising the quantity above available inventory', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    productRepository.getById.mockResolvedValueOnce(activeProduct());
    inventoryRepository.getInventory.mockResolvedValueOnce(inventory({ availableQuantity: 5 }));
    cartRepository.getCart.mockResolvedValueOnce(
      emptyCart({
        items: [
          { userId: USER_ID, productId: PRODUCT_ID, quantity: 1, createdAt: 'x', updatedAt: 'x' },
        ],
      }),
    );

    await expect(service.updateItemQuantity(USER_ID, PRODUCT_ID, 6)).rejects.toBeInstanceOf(
      InventoryUnavailableError,
    );
  });

  it('rejects a non-positive quantity before touching the repository', async () => {
    const { service, cartRepository } = createService();
    await expect(service.updateItemQuantity(USER_ID, PRODUCT_ID, 0)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(cartRepository.getCart).not.toHaveBeenCalled();
  });
});

describe('removeItem', () => {
  it('drops the line and keeps the rest of the cart intact', async () => {
    const { service, cartRepository, productRepository, inventoryRepository } = createService();
    // The response is hydrated from the remaining line, so its product/inventory lookups need a fixture.
    productRepository.getById.mockResolvedValue(activeProduct({ productId: OTHER_PRODUCT_ID }));
    inventoryRepository.getInventory.mockResolvedValue(inventory({ productId: OTHER_PRODUCT_ID }));
    const cart = emptyCart({
      items: [
        { userId: USER_ID, productId: PRODUCT_ID, quantity: 1, createdAt: 'x', updatedAt: 'x' },
        {
          userId: USER_ID,
          productId: OTHER_PRODUCT_ID,
          quantity: 2,
          createdAt: 'x',
          updatedAt: 'x',
        },
      ],
    });
    cartRepository.getCart.mockResolvedValueOnce(cart);
    cartRepository.updateCart.mockResolvedValueOnce({
      ...cart,
      items: cart.items.filter((item) => item.productId !== PRODUCT_ID),
    });

    await service.removeItem(USER_ID, PRODUCT_ID);

    expect(cartRepository.updateCart).toHaveBeenCalledWith({
      userId: USER_ID,
      items: [{ productId: OTHER_PRODUCT_ID, quantity: 2 }],
      expectedUpdatedAt: cart.updatedAt,
    });
  });

  it('404s when the product is not in the cart', async () => {
    const { service, cartRepository } = createService();
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());

    await expect(service.removeItem(USER_ID, PRODUCT_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s when the cart does not exist', async () => {
    const { service, cartRepository } = createService();
    cartRepository.getCart.mockResolvedValueOnce(null);

    await expect(service.removeItem(USER_ID, PRODUCT_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('clearCart', () => {
  it('replaces the cart contents with an empty list', async () => {
    const { service, cartRepository } = createService();
    const cart = emptyCart({
      items: [
        { userId: USER_ID, productId: PRODUCT_ID, quantity: 1, createdAt: 'x', updatedAt: 'x' },
      ],
    });
    cartRepository.getCart.mockResolvedValueOnce(cart);
    cartRepository.updateCart.mockResolvedValueOnce({ ...cart, items: [] });

    const view = await service.clearCart(USER_ID);

    expect(cartRepository.updateCart).toHaveBeenCalledWith({
      userId: USER_ID,
      items: [],
      expectedUpdatedAt: cart.updatedAt,
    });
    expect(view.items).toEqual([]);
  });

  it('is a no-op success when the cart does not exist', async () => {
    const { service, cartRepository } = createService();
    cartRepository.getCart.mockResolvedValueOnce(null);

    const view = await service.clearCart(USER_ID);

    expect(cartRepository.updateCart).not.toHaveBeenCalled();
    expect(view).toEqual({
      userId: USER_ID,
      currency: 'USD',
      items: [],
      subtotalCents: 0,
      updatedAt: null,
    });
  });

  it('is a no-op write when the cart is already empty', async () => {
    const { service, cartRepository } = createService();
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());

    await service.clearCart(USER_ID);

    expect(cartRepository.updateCart).not.toHaveBeenCalled();
  });
});
