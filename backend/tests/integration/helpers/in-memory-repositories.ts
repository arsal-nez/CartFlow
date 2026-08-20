import type { Cart, CartItem } from '../../../src/domain/cart';
import type { Inventory } from '../../../src/domain/inventory';
import type { Product } from '../../../src/domain/product';
import { ConflictError, NotFoundError } from '../../../src/errors/app-error';
import type { CartRepository } from '../../../src/repositories/cart.repository';
import type { InventoryRepository } from '../../../src/repositories/inventory.repository';
import type { ProductRepository } from '../../../src/repositories/product.repository';

/**
 * In-memory stand-ins for the DynamoDB repositories, built specifically to
 * exercise real concurrency: every operation yields on a macrotask
 * (`setImmediate`) between "read" and "commit", the same way a real
 * DynamoDB round trip would let another concurrent Lambda invocation's
 * request interleave. Two `service.addItem()` calls started together via
 * `Promise.all` therefore genuinely race here, rather than just running
 * one after the other because JS is single-threaded.
 *
 * The optimistic-lock and conditional-create semantics mirror the real
 * `CartRepository` exactly: `createCart` fails if a header already exists,
 * `updateCart` fails if `expectedUpdatedAt` no longer matches what's stored.
 */

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

let versionCounter = 0;
function nextVersion(): string {
  versionCounter += 1;
  return `v${versionCounter}`;
}

export function createInMemoryCartRepository(): CartRepository {
  let store: Cart | null = null;

  return {
    async getCart(userId: string): Promise<Cart | null> {
      await nextTick();
      if (store === null || store.userId !== userId) {
        return null;
      }
      return structuredClone(store);
    },

    async createCart(input): Promise<Cart> {
      await nextTick();
      if (store !== null) {
        throw new ConflictError(`Cart for user ${input.userId} already exists`);
      }
      const timestamp = nextVersion();
      store = {
        userId: input.userId,
        currency: input.currency ?? 'USD',
        createdAt: timestamp,
        updatedAt: timestamp,
        items: [],
      };
      return structuredClone(store);
    },

    async updateCart(input): Promise<Cart> {
      await nextTick();
      if (store === null || store.userId !== input.userId) {
        throw new NotFoundError(`Cart for user ${input.userId} not found`);
      }
      if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== store.updatedAt) {
        throw new ConflictError(`Cart for user ${input.userId} was modified concurrently`);
      }
      const timestamp = nextVersion();
      const items: CartItem[] = input.items
        .filter((item) => item.quantity > 0)
        .map((item) => {
          const previous = store?.items.find((existing) => existing.productId === item.productId);
          return {
            userId: input.userId,
            productId: item.productId,
            quantity: item.quantity,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
        });
      store = { ...store, updatedAt: timestamp, items };
      return structuredClone(store);
    },
  };
}

export function createInMemoryProductRepository(seed: Product[]): ProductRepository {
  const products = new Map(seed.map((product) => [product.productId, product]));

  return {
    async getById(productId: string): Promise<Product | null> {
      await nextTick();
      const product = products.get(productId);
      return product === undefined ? null : structuredClone(product);
    },
    create: jest.fn(),
    list: jest.fn(),
    listByCategory: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    delete: jest.fn(),
  } as unknown as ProductRepository;
}

export function createInMemoryInventoryRepository(seed: Inventory[]): InventoryRepository {
  const inventories = new Map(seed.map((inv) => [inv.productId, inv]));

  return {
    async getInventory(productId: string): Promise<Inventory | null> {
      await nextTick();
      const inv = inventories.get(productId);
      return inv === undefined ? null : structuredClone(inv);
    },
    updateInventory: jest.fn(),
  } as unknown as InventoryRepository;
}
