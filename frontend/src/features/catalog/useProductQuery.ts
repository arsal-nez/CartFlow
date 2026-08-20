import { useQuery } from '@tanstack/react-query';

import { getProduct, getProductStock } from '../../api/products';
import { queryKeys } from '../../api/queryKeys';

export function useProductQuery(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.products.detail(productId ?? ''),
    queryFn: ({ signal }) => getProduct(productId ?? '', signal),
    enabled: productId !== undefined,
  });
}

export function useProductStockQuery(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.products.stock(productId ?? ''),
    queryFn: ({ signal }) => getProductStock(productId ?? '', signal),
    enabled: productId !== undefined,
  });
}
