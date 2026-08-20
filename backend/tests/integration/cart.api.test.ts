/**
 * Full-stack integration tests: real API Gateway event -> real Middy
 * handler chain (CORS, `requireAuthentication()`, Zod `validate()`,
 * `errorHandler()`) -> real `CartService` business logic (stock checks,
 * "not found" mapping, optimistic-concurrency retry) -> repositories
 * implementing the real `CartRepository`/`ProductRepository`/
 * `InventoryRepository` interfaces.
 *
 * Repositories are stubbed at the interface boundary here rather than
 * simulated at the raw DynamoDB-command level (contrast
 * `products.api.test.ts`): cart writes go through a multi-step
 * read/check/`TransactWriteCommand` sequence across three repositories,
 * and that DynamoDB-command shape is already exhaustively verified by
 * `cart.repository.test.ts` and the concurrency suite in
 * `cart.concurrency.test.ts`. What this file adds is proof that a real
 * HTTP request is correctly authenticated, validated, and routed into
 * that real service logic, and that the service's errors come back out
 * as the right HTTP status codes.
 */
import { buildAddCartItemHandler } from '../../src/handlers/cart/add-item';
import { buildGetCartHandler } from '../../src/handlers/cart/get';
import { buildUpdateCartItemHandler } from '../../src/handlers/cart/update-item';
import { buildRemoveCartItemHandler } from '../../src/handlers/cart/remove-item';
import type { Cart } from '../../src/domain/cart';
import type { Inventory } from '../../src/domain/inventory';
import type { Product } from '../../src/domain/product';
import type { CartRepository } from '../../src/repositories/cart.repository';
import type { InventoryRepository } from '../../src/repositories/inventory.repository';
import type { ProductRepository } from '../../src/repositories/product.repository';
import { createCartService } from '../../src/services/cart.service';
import { buildEvent, fakeLambdaContext, parseBody } from '../unit/helpers/fake-event';

const USER_ID = 'user-1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const CLAIMS = { sub: USER_ID };

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

function setup() {
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
  const service = createCartService({ cartRepository, productRepository, inventoryRepository });

  return {
    cartRepository,
    productRepository,
    inventoryRepository,
    handlers: {
      add: buildAddCartItemHandler(service),
      get: buildGetCartHandler(service),
      update: buildUpdateCartItemHandler(service),
      remove: buildRemoveCartItemHandler(service),
    },
  };
}

describe('POST /api/v1/cart/items (full stack)', () => {
  it('201s and adds the line for an authenticated caller', async () => {
    const { cartRepository, productRepository, inventoryRepository, handlers } = setup();
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());
    // Called twice: once by `requireActiveProduct` during the write, once
    // more by `hydrate()` when building the response view.
    productRepository.getById.mockResolvedValue(activeProduct());
    inventoryRepository.getInventory.mockResolvedValue(inventory());
    cartRepository.updateCart.mockResolvedValueOnce(
      emptyCart({
        items: [
          { userId: USER_ID, productId: PRODUCT_ID, quantity: 2, createdAt: 'x', updatedAt: 'x' },
        ],
      }),
    );

    const result = await handlers.add(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 2 },
        claims: CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(201);
    expect(parseBody(result).data).toMatchObject({
      items: [expect.objectContaining({ productId: PRODUCT_ID, quantity: 2 })],
    });
  });

  it('401s an unauthenticated caller before touching any repository', async () => {
    const { cartRepository, handlers } = setup();

    const result = await handlers.add(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 2 },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(cartRepository.getCart).not.toHaveBeenCalled();
  });

  it.each([0, -1])(
    '400s a non-positive quantity (%p) before touching any repository',
    async (quantity) => {
      const { cartRepository, handlers } = setup();

      const result = await handlers.add(
        buildEvent({
          method: 'POST',
          path: '/api/v1/cart/items',
          body: { productId: PRODUCT_ID, quantity },
          claims: CLAIMS,
        }),
        fakeLambdaContext,
      );

      expect(result.statusCode).toBe(400);
      expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(cartRepository.getCart).not.toHaveBeenCalled();
    },
  );

  it('400s an invalid (non-UUID) productId before touching any repository', async () => {
    const { cartRepository, handlers } = setup();

    const result = await handlers.add(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: 'not-a-uuid', quantity: 1 },
        claims: CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(cartRepository.getCart).not.toHaveBeenCalled();
  });

  it('404s when the product does not exist', async () => {
    const { cartRepository, productRepository, handlers } = setup();
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());
    productRepository.getById.mockResolvedValueOnce(null);

    const result = await handlers.add(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 1 },
        claims: CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('409s when the requested quantity exceeds available stock (out-of-stock product)', async () => {
    const { cartRepository, productRepository, inventoryRepository, handlers } = setup();
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());
    productRepository.getById.mockResolvedValueOnce(activeProduct());
    inventoryRepository.getInventory.mockResolvedValueOnce(inventory({ availableQuantity: 0 }));

    const result = await handlers.add(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 1 },
        claims: CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).error).toMatchObject({ code: 'INVENTORY_UNAVAILABLE' });
  });

  it('500s and hides the underlying cause on an unexpected repository failure', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { cartRepository, handlers } = setup();
    cartRepository.getCart.mockRejectedValueOnce(new Error('DynamoDB is unreachable'));

    const result = await handlers.add(
      buildEvent({
        method: 'POST',
        path: '/api/v1/cart/items',
        body: { productId: PRODUCT_ID, quantity: 1 },
        claims: CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(JSON.stringify(parseBody(result))).not.toContain('DynamoDB is unreachable');
    consoleSpy.mockRestore();
  });
});

describe('GET /api/v1/cart (full stack)', () => {
  it("200s the caller's own cart, never another user's", async () => {
    const { cartRepository, handlers } = setup();
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());

    const result = await handlers.get(
      buildEvent({ path: '/api/v1/cart', claims: CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(cartRepository.getCart).toHaveBeenCalledWith(USER_ID);
  });

  it('401s an unauthenticated caller', async () => {
    const { handlers } = setup();

    const result = await handlers.get(buildEvent({ path: '/api/v1/cart' }), fakeLambdaContext);

    expect(result.statusCode).toBe(401);
  });
});

describe('PATCH /api/v1/cart/items/{productId} (full stack)', () => {
  it('404s updating a line that is not in the cart', async () => {
    const { cartRepository, productRepository, handlers } = setup();
    // `updateItemQuantity` checks the product exists/is active before
    // checking whether it's actually a line in the cart.
    productRepository.getById.mockResolvedValueOnce(activeProduct());
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());

    const result = await handlers.update(
      buildEvent({
        method: 'PATCH',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        body: { quantity: 5 },
        claims: CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
  });

  it('400s a zero quantity — DELETE removes a line, PATCH never accepts zero', async () => {
    const { cartRepository, handlers } = setup();

    const result = await handlers.update(
      buildEvent({
        method: 'PATCH',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        body: { quantity: 0 },
        claims: CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(cartRepository.getCart).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/cart/items/{productId} (full stack)', () => {
  it('404s removing a line that is not in the cart', async () => {
    const { cartRepository, handlers } = setup();
    cartRepository.getCart.mockResolvedValueOnce(emptyCart());

    const result = await handlers.remove(
      buildEvent({
        method: 'DELETE',
        path: `/api/v1/cart/items/${PRODUCT_ID}`,
        pathParameters: { productId: PRODUCT_ID },
        claims: CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
  });
});
