import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addCartItem,
  clearCart,
  getCart,
  removeCartItem,
  updateCartItemQuantity,
  type Cart,
} from '../../api/cart';
import { queryKeys } from '../../api/queryKeys';
import { useAuth } from '../../auth/AuthContext';

export function useCartQuery() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.cart.root,
    queryFn: ({ signal }) => getCart(signal),
    enabled: isAuthenticated,
  });
}

function useApplyCartResult() {
  const queryClient = useQueryClient();
  return (cart: Cart) => queryClient.setQueryData(queryKeys.cart.root, cart);
}

export function useAddCartItemMutation() {
  const applyResult = useApplyCartResult();
  return useMutation({
    mutationFn: (input: { productId: string; quantity: number }) => addCartItem(input),
    onSuccess: applyResult,
  });
}

export function useUpdateCartItemMutation() {
  const applyResult = useApplyCartResult();
  return useMutation({
    mutationFn: ({ productId, quantity }: { productId: string; quantity: number }) =>
      updateCartItemQuantity(productId, quantity),
    onSuccess: applyResult,
  });
}

export function useRemoveCartItemMutation() {
  const applyResult = useApplyCartResult();
  return useMutation({
    mutationFn: (productId: string) => removeCartItem(productId),
    onSuccess: applyResult,
  });
}

export function useClearCartMutation() {
  const applyResult = useApplyCartResult();
  return useMutation({
    mutationFn: () => clearCart(),
    onSuccess: applyResult,
  });
}
