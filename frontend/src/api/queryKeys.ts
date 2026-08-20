import type { AdminListProductsParams } from './adminProducts';
import type { ListProductsParams } from './products';

/** Centralised TanStack Query key factory, so invalidation stays consistent across the app. */
export const queryKeys = {
  products: {
    all: ['products'] as const,
    list: (params: ListProductsParams) => ['products', 'list', params] as const,
    detail: (productId: string) => ['products', 'detail', productId] as const,
    stock: (productId: string) => ['products', 'stock', productId] as const,
  },
  cart: {
    root: ['cart'] as const,
  },
  admin: {
    products: {
      all: ['admin', 'products'] as const,
      list: (params: AdminListProductsParams) => ['admin', 'products', 'list', params] as const,
      /** Distinct categoryId values seen across ACTIVE products — powers the category picker. */
      knownCategories: ['admin', 'products', 'known-categories'] as const,
    },
    inventory: {
      detail: (productId: string) => ['admin', 'inventory', 'detail', productId] as const,
    },
  },
};
