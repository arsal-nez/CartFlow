export type ProductStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

export const PRODUCT_STATUSES: readonly ProductStatus[] = ['ACTIVE', 'DRAFT', 'ARCHIVED'];

export interface Product {
  productId: string;
  name: string;
  /** Lower-cased, punctuation-stripped name used as the GSI1 sort component. */
  normalizedName: string;
  description: string;
  categoryId: string;
  status: ProductStatus;
  priceCents: number;
  currency: string;
  imageKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  productId: string;
  name: string;
  description: string;
  categoryId: string;
  priceCents: number;
  currency: string;
  status?: ProductStatus;
  imageKeys?: string[];
}

export interface UpdateProductPatch {
  name?: string;
  description?: string;
  categoryId?: string;
  priceCents?: number;
  currency?: string;
  status?: ProductStatus;
  imageKeys?: string[];
  /**
   * Optimistic concurrency guard. When supplied, the write only lands if the
   * stored `updatedAt` still matches.
   */
  expectedUpdatedAt?: string;
}

export interface ListProductsParams {
  status?: ProductStatus;
  limit?: number;
  cursor?: string | null;
}

export interface ListProductsByCategoryParams extends ListProductsParams {
  categoryId: string;
}

/**
 * Normalizes a display name into a GSI sort key component:
 * lower case, alphanumerics preserved, everything else collapsed to `-`.
 * `#` must never survive — it is the key-segment delimiter.
 */
export function normalizeProductName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
