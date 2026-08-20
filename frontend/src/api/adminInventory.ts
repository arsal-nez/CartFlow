import { apiFetch } from './client';
import type { StockStatus } from './products';

/** Admin-only view of a product's stock. Mirrors `backend/src/services/inventory.service.ts`'s `AdminStockView`. */
export interface AdminStock {
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  reorderThreshold: number;
  stockStatus: StockStatus;
  /** `null` when the product has never been stocked. */
  updatedAt: string | null;
}

export async function getAdminStock(productId: string, signal?: AbortSignal): Promise<AdminStock> {
  return apiFetch<AdminStock>(`/api/v1/admin/inventory/${encodeURIComponent(productId)}`, {
    signal,
  });
}

export interface UpdateStockInput {
  /** Absolute count — this is "set the stock to X", not a delta. */
  availableQuantity?: number | undefined;
  reorderThreshold?: number | undefined;
  /** Optimistic concurrency guard against the stored `updatedAt`. */
  expectedUpdatedAt?: string | undefined;
}

export async function updateAdminStock(
  productId: string,
  input: UpdateStockInput,
  signal?: AbortSignal,
): Promise<AdminStock> {
  return apiFetch<AdminStock>(`/api/v1/admin/inventory/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: input,
    signal,
  });
}
