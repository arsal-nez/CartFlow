import { apiFetch, apiFetchPage } from './client';
import type { Product, ProductStatus } from './products';

/**
 * Admin-only product management. Mirrors `backend/src/handlers/products/`
 * (`admin-list`, `create`, `update`, `remove`) — every mutation here
 * requires the caller to be in the Cognito `admin` group; the API enforces
 * that server-side regardless of what the UI shows.
 */

export interface AdminListProductsParams {
  status?: ProductStatus | undefined;
  categoryId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface AdminProductsPage {
  items: Product[];
  nextCursor: string | null;
  limit: number;
}

export async function listAdminProducts(
  params: AdminListProductsParams = {},
  signal?: AbortSignal,
): Promise<AdminProductsPage> {
  const { items, page } = await apiFetchPage<Product>('/api/v1/admin/products', {
    query: {
      status: params.status,
      categoryId: params.categoryId,
      limit: params.limit,
      cursor: params.cursor,
    },
    signal,
  });
  return { items, nextCursor: page.nextCursor, limit: page.limit };
}

export interface CreateProductInput {
  name: string;
  description: string;
  categoryId: string;
  priceCents: number;
  currency: string;
  status?: ProductStatus | undefined;
  imageKeys?: string[] | undefined;
}

export async function createProduct(
  input: CreateProductInput,
  signal?: AbortSignal,
): Promise<Product> {
  return apiFetch<Product>('/api/v1/products', { method: 'POST', body: input, signal });
}

export interface UpdateProductInput {
  name?: string | undefined;
  description?: string | undefined;
  categoryId?: string | undefined;
  priceCents?: number | undefined;
  currency?: string | undefined;
  status?: ProductStatus | undefined;
  imageKeys?: string[] | undefined;
}

export async function updateProduct(
  productId: string,
  input: UpdateProductInput,
  signal?: AbortSignal,
): Promise<Product> {
  return apiFetch<Product>(`/api/v1/products/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: input,
    signal,
  });
}

/** Soft delete — flips the product's status to ARCHIVED server-side, per `ProductRepository.deactivate`. */
export async function deleteProduct(productId: string, signal?: AbortSignal): Promise<Product> {
  return apiFetch<Product>(`/api/v1/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    signal,
  });
}
