import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAdminStock, updateAdminStock, type UpdateStockInput } from '../../api/adminInventory';
import { queryKeys } from '../../api/queryKeys';

export function useAdminStockQuery(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.admin.inventory.detail(productId ?? ''),
    queryFn: ({ signal }) => getAdminStock(productId as string, signal),
    enabled: productId !== undefined,
  });
}

export function useUpdateStockMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStockInput) => updateAdminStock(productId, input),
    onSuccess: (stock) => {
      queryClient.setQueryData(queryKeys.admin.inventory.detail(productId), stock);
      // The customer-facing stock view is a narrower projection of the same
      // record — invalidate it too so the storefront reflects the change.
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.stock(productId) });
    },
  });
}
