import type { StockStatus } from '../domain/inventory';
import {
  createInventoryRepository,
  type InventoryRepository,
} from '../repositories/inventory.repository';

/**
 * The public, customer-facing view of a product's stock. Deliberately a
 * narrower projection than the full `Inventory` record: `reservedQuantity`
 * and `reorderThreshold` are operational/admin concerns, not something a
 * storefront should expose.
 */
export interface PublicStockView {
  productId: string;
  availableQuantity: number;
  stockStatus: StockStatus;
}

/**
 * The admin-facing view of a product's stock: every counter the storefront
 * hides, plus the reorder threshold that drives the LOW badge. `updatedAt`
 * is `null` when the product has never been stocked (no inventory record
 * yet) — that state is reported rather than treated as an error, same as
 * `getPublicStock`.
 */
export interface AdminStockView {
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  reorderThreshold: number;
  stockStatus: StockStatus;
  updatedAt: string | null;
}

export interface UpdateStockCommand {
  availableQuantity?: number | undefined;
  reorderThreshold?: number | undefined;
  expectedUpdatedAt?: string | undefined;
}

export interface InventoryService {
  /**
   * Never 404s: a product with no inventory record yet has simply never
   * been stocked, which is reported as zero available stock rather than an
   * error — consistent with how `CartService` treats a missing inventory
   * record (see docs/database.md, "Cart Concurrency And Consistency").
   */
  getPublicStock(productId: string): Promise<PublicStockView>;
  /** Admin only — see `AdminStockView`. Also never 404s, for the same reason. */
  getAdminStock(productId: string): Promise<AdminStockView>;
  /**
   * Admin only. A strongly-consistent read precedes the write inside
   * `InventoryRepository.updateInventory`, so this always acts on the
   * latest counters; `expectedUpdatedAt` is an optional extra guard against
   * a stale admin UI overwriting a concurrent change with the same values.
   * Absolute values only — no delta support here, since an admin editing a
   * stock count is setting a new count, not applying a sale/return delta
   * (that's `CartService`'s concern).
   */
  updateStock(productId: string, command: UpdateStockCommand): Promise<AdminStockView>;
}

export interface InventoryServiceOptions {
  repository?: InventoryRepository;
}

export function createInventoryService(options: InventoryServiceOptions = {}): InventoryService {
  const repository = options.repository ?? createInventoryRepository();

  return {
    async getPublicStock(productId) {
      const inventory = await repository.getInventory(productId);
      if (inventory === null) {
        return { productId, availableQuantity: 0, stockStatus: 'OUT_OF_STOCK' };
      }
      return {
        productId,
        availableQuantity: inventory.availableQuantity,
        stockStatus: inventory.stockStatus,
      };
    },

    async getAdminStock(productId) {
      const inventory = await repository.getInventory(productId, { consistentRead: true });
      if (inventory === null) {
        return {
          productId,
          availableQuantity: 0,
          reservedQuantity: 0,
          reorderThreshold: 0,
          stockStatus: 'OUT_OF_STOCK',
          updatedAt: null,
        };
      }
      return {
        productId,
        availableQuantity: inventory.availableQuantity,
        reservedQuantity: inventory.reservedQuantity,
        reorderThreshold: inventory.reorderThreshold,
        stockStatus: inventory.stockStatus,
        updatedAt: inventory.updatedAt,
      };
    },

    async updateStock(productId, command) {
      const inventory = await repository.updateInventory(productId, {
        ...(command.availableQuantity === undefined
          ? {}
          : { availableQuantity: command.availableQuantity }),
        ...(command.reorderThreshold === undefined
          ? {}
          : { reorderThreshold: command.reorderThreshold }),
        ...(command.expectedUpdatedAt === undefined
          ? {}
          : { expectedUpdatedAt: command.expectedUpdatedAt }),
      });
      return {
        productId: inventory.productId,
        availableQuantity: inventory.availableQuantity,
        reservedQuantity: inventory.reservedQuantity,
        reorderThreshold: inventory.reorderThreshold,
        stockStatus: inventory.stockStatus,
        updatedAt: inventory.updatedAt,
      };
    },
  };
}
