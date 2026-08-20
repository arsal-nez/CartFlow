import { apiFetch, apiFetchPage } from './client';

/**
 * Mirrors `backend/src/domain/product.ts` and `backend/src/services/inventory.service.ts`'s
 * public projections. See the note in `api/types.ts` on why these are
 * hand-written rather than imported from the backend workspace.
 */

export type ProductStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

export interface Product {
  productId: string;
  name: string;
  description: string;
  categoryId: string;
  status: ProductStatus;
  priceCents: number;
  currency: string;
  imageKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export type StockStatus = 'IN_STOCK' | 'LOW' | 'OUT_OF_STOCK';

export interface ProductStock {
  productId: string;
  availableQuantity: number;
  stockStatus: StockStatus;
}

export interface ListProductsParams {
  categoryId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface ProductsPage {
  items: Product[];
  nextCursor: string | null;
  limit: number;
}

export async function listProducts(
  params: ListProductsParams = {},
  signal?: AbortSignal,
): Promise<ProductsPage> {
  const { items, page } = await apiFetchPage<Product>('/api/v1/products', {
    query: { categoryId: params.categoryId, limit: params.limit, cursor: params.cursor },
    signal,
  });
  return { items, nextCursor: page.nextCursor, limit: page.limit };
}

export async function getProduct(productId: string, signal?: AbortSignal): Promise<Product> {
  return apiFetch<Product>(`/api/v1/products/${encodeURIComponent(productId)}`, { signal });
}

export async function getProductStock(
  productId: string,
  signal?: AbortSignal,
): Promise<ProductStock> {
  return apiFetch<ProductStock>(`/api/v1/products/${encodeURIComponent(productId)}/inventory`, {
    signal,
  });
}
