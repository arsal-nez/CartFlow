export type StockStatus = 'IN_STOCK' | 'LOW' | 'OUT_OF_STOCK';

export interface Inventory {
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  reorderThreshold: number;
  stockStatus: StockStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateInventoryInput {
  /** Absolute quantity. Mutually exclusive with `availableQuantityDelta`. */
  availableQuantity?: number;
  /** Relative adjustment, e.g. `-2` when two units are sold. */
  availableQuantityDelta?: number;
  reservedQuantity?: number;
  reservedQuantityDelta?: number;
  reorderThreshold?: number;
  /** Optimistic concurrency guard against the stored `updatedAt`. */
  expectedUpdatedAt?: string;
}

/** Derives the denormalized status used by the low-stock admin view. */
export function deriveStockStatus(
  availableQuantity: number,
  reorderThreshold: number,
): StockStatus {
  if (availableQuantity <= 0) {
    return 'OUT_OF_STOCK';
  }
  if (availableQuantity <= reorderThreshold) {
    return 'LOW';
  }
  return 'IN_STOCK';
}
