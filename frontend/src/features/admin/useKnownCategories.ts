import { useQuery } from '@tanstack/react-query';

import { listAdminProducts } from '../../api/adminProducts';
import { queryKeys } from '../../api/queryKeys';

/**
 * CartFlow has no separate "Category" entity — `categoryId` is a free-form
 * field on `Product` itself (see `backend/src/domain/product.ts`). So
 * "category selection" here means picking from categories that real
 * products already use, not a hard-coded list: this derives the set from
 * the currently active catalog. A brand-new category is still just typed
 * in — see `ProductForm`'s `<datalist>` combo.
 */
export function useKnownCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.admin.products.knownCategories,
    queryFn: async ({ signal }) => {
      const page = await listAdminProducts({ status: 'ACTIVE', limit: 100 }, signal);
      const categories = new Set(page.items.map((product) => product.categoryId));
      return Array.from(categories).sort((a, b) => a.localeCompare(b));
    },
    staleTime: 60_000,
  });
}
