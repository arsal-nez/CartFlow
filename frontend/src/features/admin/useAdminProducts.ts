import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createProduct,
  deleteProduct,
  listAdminProducts,
  updateProduct,
  type AdminListProductsParams,
  type CreateProductInput,
  type UpdateProductInput,
} from '../../api/adminProducts';
import { queryKeys } from '../../api/queryKeys';

export function useAdminProductsQuery(params: AdminListProductsParams) {
  return useQuery({
    queryKey: queryKeys.admin.products.list(params),
    queryFn: ({ signal }) => listAdminProducts(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useCreateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => createProduct(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.products.all });
    },
  });
}

export function useUpdateProductMutation(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProductInput) => updateProduct(productId, input),
    onSuccess: (product) => {
      queryClient.setQueryData(queryKeys.products.detail(productId), product);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.products.all });
    },
  });
}

export function useDeleteProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => deleteProduct(productId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.products.all });
    },
  });
}
