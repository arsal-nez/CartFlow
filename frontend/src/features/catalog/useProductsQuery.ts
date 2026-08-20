import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { listProducts, type ListProductsParams } from '../../api/products';
import { queryKeys } from '../../api/queryKeys';

/** `keepPreviousData` keeps the current page's products on screen (instead of a loading flash) while the next page loads. */
export function useProductsQuery(params: ListProductsParams) {
  return useQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: ({ signal }) => listProducts(params, signal),
    placeholderData: keepPreviousData,
  });
}
