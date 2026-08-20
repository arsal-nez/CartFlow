import type { Cart } from '../domain/cart';
import type { Product } from '../domain/product';
import {
  ConflictError,
  InventoryUnavailableError,
  NotFoundError,
  ValidationError,
} from '../errors/app-error';
import { createCartRepository, type CartRepository } from '../repositories/cart.repository';
import {
  createInventoryRepository,
  type InventoryRepository,
} from '../repositories/inventory.repository';
import {
  createProductRepository,
  type ProductRepository,
} from '../repositories/product.repository';

/**
 * One hydrated cart line. `name`, `priceCents`, and `currency` are read from
 * the authoritative product record at request time — never from what was
 * stored when the line was added, and never from anything the client sent.
 * A price change since the item was added is reflected immediately.
 */
export interface CartLineView {
  productId: string;
  name: string;
  priceCents: number;
  currency: string;
  quantity: number;
  /** `priceCents * quantity`, or `0` when `productAvailable` is `false`. */
  lineTotalCents: number;
  /** `false` once the product has been archived (or hard-deleted) since it was added. */
  productAvailable: boolean;
  /** Units currently sellable, for "only N left" UX. `0` if the product record is gone. */
  availableQuantity: number;
}

export interface CartView {
  userId: string;
  currency: string;
  items: CartLineView[];
  /** Sum of available lines' `lineTotalCents` — computed here on every read, never stored. */
  subtotalCents: number;
  updatedAt: string | null;
}

export interface CartService {
  getCart(userId: string): Promise<CartView>;
  /** Adds `quantity` to the line if the product is already in the cart, else creates it. */
  addItem(userId: string, productId: string, quantity: number): Promise<CartView>;
  /** Sets an existing line to an absolute quantity. 404s if the product isn't in the cart. */
  updateItemQuantity(userId: string, productId: string, quantity: number): Promise<CartView>;
  /** Removes a line entirely. 404s if the product isn't in the cart. */
  removeItem(userId: string, productId: string): Promise<CartView>;
  /** Empties the cart. Idempotent: a missing or already-empty cart is not an error. */
  clearCart(userId: string): Promise<CartView>;
}

export interface CartServiceOptions {
  cartRepository?: CartRepository;
  productRepository?: ProductRepository;
  inventoryRepository?: InventoryRepository;
  /**
   * Bounded retries for the optimistic-concurrency race on the cart's
   * `updatedAt` lock (see docs/database.md, "Cart Concurrency And
   * Consistency"). Configurable so tests can exercise "retries exhausted"
   * without looping the default count.
   */
  maxConflictRetries?: number;
}

const DEFAULT_MAX_CONFLICT_RETRIES = 5;

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a positive integer');
  }
}

function emptyCartView(userId: string): CartView {
  return { userId, currency: 'USD', items: [], subtotalCents: 0, updatedAt: null };
}

/**
 * Business rules for the Cart API. `userId` is a parameter on every method
 * here, but it is only ever supplied by a handler that read it from
 * `getCurrentUser()` — the verified JWT `sub` claim. Nothing in this service
 * (or the schemas feeding it) accepts a `userId` field from a request body,
 * so there is no path by which a caller can name someone else's cart.
 */
export function createCartService(options: CartServiceOptions = {}): CartService {
  const cartRepository = options.cartRepository ?? createCartRepository();
  const productRepository = options.productRepository ?? createProductRepository();
  const inventoryRepository = options.inventoryRepository ?? createInventoryRepository();
  const maxConflictRetries = options.maxConflictRetries ?? DEFAULT_MAX_CONFLICT_RETRIES;

  /**
   * Retries the whole read-check-write sequence on a lost optimistic-lock
   * race (`ConflictError` from `CartRepository.updateCart`). A conflict
   * means the cart changed between our read and our write, so re-running the
   * operation re-reads the cart and re-validates inventory rather than
   * blindly resubmitting a stale write.
   */
  async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        attempt += 1;
        if (!(error instanceof ConflictError) || attempt >= maxConflictRetries) {
          throw error;
        }
      }
    }
  }

  /**
   * Creates the cart header on first use. Two concurrent first-writes for
   * the same user both see no cart and both call `createCart`, which is
   * guarded by `attribute_not_exists(PK)`; the loser gets a `ConflictError`
   * that just means "the header already exists" — exactly the outcome it
   * wanted — so it is swallowed here rather than surfaced as a failure.
   */
  async function ensureCart(userId: string): Promise<Cart> {
    const existing = await cartRepository.getCart(userId);
    if (existing !== null) {
      return existing;
    }
    try {
      return await cartRepository.createCart({ userId });
    } catch (error) {
      if (error instanceof ConflictError) {
        const createdByAnotherRequest = await cartRepository.getCart(userId);
        if (createdByAnotherRequest !== null) {
          return createdByAnotherRequest;
        }
      }
      throw error;
    }
  }

  async function requireActiveProduct(productId: string): Promise<Product> {
    const product = await productRepository.getById(productId);
    if (product === null) {
      throw new NotFoundError(`Product ${productId} not found`);
    }
    if (product.status !== 'ACTIVE') {
      throw new ConflictError(`Product ${productId} is not available for purchase`);
    }
    return product;
  }

  /**
   * Rejects a quantity that exceeds current stock. The inventory read is
   * strongly consistent so this decision sees the latest committed stock
   * count, but this is still a soft, point-in-time check: nothing is
   * reserved or decremented here. Checkout re-reads inventory and performs
   * the authoritative, stock-decrementing check — see
   * docs/database.md, "Cart Concurrency And Consistency".
   */
  async function assertQuantityAvailable(
    productId: string,
    requestedQuantity: number,
  ): Promise<void> {
    const inventory = await inventoryRepository.getInventory(productId, { consistentRead: true });
    const availableQuantity = inventory?.availableQuantity ?? 0;
    if (requestedQuantity > availableQuantity) {
      throw new InventoryUnavailableError(
        `Only ${availableQuantity} unit(s) of product ${productId} are available`,
      );
    }
  }

  async function hydrate(cart: Cart): Promise<CartView> {
    const lines = await Promise.all(
      cart.items.map(async (item): Promise<CartLineView | null> => {
        const product = await productRepository.getById(item.productId);
        if (product === null) {
          // Hard-deleted after being added — nothing left to price it with; drop the line.
          return null;
        }

        const productAvailable = product.status === 'ACTIVE';
        const inventory = await inventoryRepository.getInventory(item.productId);
        const availableQuantity = inventory?.availableQuantity ?? 0;

        return {
          productId: item.productId,
          name: product.name,
          priceCents: product.priceCents,
          currency: product.currency,
          quantity: item.quantity,
          lineTotalCents: productAvailable ? product.priceCents * item.quantity : 0,
          productAvailable,
          availableQuantity,
        };
      }),
    );

    const visibleLines = lines.filter((line): line is CartLineView => line !== null);
    const subtotalCents = visibleLines.reduce((sum, line) => sum + line.lineTotalCents, 0);

    return {
      userId: cart.userId,
      currency: cart.currency,
      items: visibleLines,
      subtotalCents,
      updatedAt: cart.updatedAt,
    };
  }

  return {
    async getCart(userId) {
      const cart = await cartRepository.getCart(userId);
      return cart === null ? emptyCartView(userId) : hydrate(cart);
    },

    async addItem(userId, productId, quantity) {
      assertPositiveQuantity(quantity);
      // Deliberately outside withRetry: whether a product exists and is
      // ACTIVE is not something a lost cart-write race can change, so
      // retrying it would just repeat the same deterministic rejection
      // (and burn through the retry budget doing it).
      await requireActiveProduct(productId);

      const updated = await withRetry(async () => {
        const cart = await ensureCart(userId);
        const existingLine = cart.items.find((item) => item.productId === productId);
        const nextQuantity = (existingLine?.quantity ?? 0) + quantity;

        await assertQuantityAvailable(productId, nextQuantity);

        const items = cart.items
          .filter((item) => item.productId !== productId)
          .map((item) => ({ productId: item.productId, quantity: item.quantity }));
        items.push({ productId, quantity: nextQuantity });

        return cartRepository.updateCart({ userId, items, expectedUpdatedAt: cart.updatedAt });
      });

      return hydrate(updated);
    },

    async updateItemQuantity(userId, productId, quantity) {
      assertPositiveQuantity(quantity);
      // See addItem: product existence/active-ness is checked once, outside
      // the retry loop, since it cannot be affected by a lost cart-write race.
      await requireActiveProduct(productId);

      const updated = await withRetry(async () => {
        const cart = await cartRepository.getCart(userId);
        if (cart === null || !cart.items.some((item) => item.productId === productId)) {
          throw new NotFoundError(`Product ${productId} is not in the cart`);
        }

        await assertQuantityAvailable(productId, quantity);

        const items = cart.items.map((item) => ({
          productId: item.productId,
          quantity: item.productId === productId ? quantity : item.quantity,
        }));

        return cartRepository.updateCart({ userId, items, expectedUpdatedAt: cart.updatedAt });
      });

      return hydrate(updated);
    },

    async removeItem(userId, productId) {
      const updated = await withRetry(async () => {
        const cart = await cartRepository.getCart(userId);
        if (cart === null || !cart.items.some((item) => item.productId === productId)) {
          throw new NotFoundError(`Product ${productId} is not in the cart`);
        }

        const items = cart.items
          .filter((item) => item.productId !== productId)
          .map((item) => ({ productId: item.productId, quantity: item.quantity }));

        return cartRepository.updateCart({ userId, items, expectedUpdatedAt: cart.updatedAt });
      });

      return hydrate(updated);
    },

    async clearCart(userId) {
      const updated = await withRetry(async (): Promise<Cart | null> => {
        const cart = await cartRepository.getCart(userId);
        if (cart === null || cart.items.length === 0) {
          return cart;
        }
        return cartRepository.updateCart({ userId, items: [], expectedUpdatedAt: cart.updatedAt });
      });

      return updated === null ? emptyCartView(userId) : hydrate(updated);
    },
  };
}
