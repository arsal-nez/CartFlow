import { apiFetch } from './client';

/** Mirrors `backend/src/services/cart.service.ts`'s `CartView`/`CartLineView`. */

export interface CartLine {
  productId: string;
  name: string;
  priceCents: number;
  currency: string;
  quantity: number;
  lineTotalCents: number;
  productAvailable: boolean;
  availableQuantity: number;
}

export interface Cart {
  userId: string;
  currency: string;
  items: CartLine[];
  subtotalCents: number;
  updatedAt: string | null;
}

export async function getCart(signal?: AbortSignal): Promise<Cart> {
  return apiFetch<Cart>('/api/v1/cart', { signal });
}

export async function addCartItem(
  input: { productId: string; quantity: number },
  signal?: AbortSignal,
): Promise<Cart> {
  return apiFetch<Cart>('/api/v1/cart/items', { method: 'POST', body: input, signal });
}

export async function updateCartItemQuantity(
  productId: string,
  quantity: number,
  signal?: AbortSignal,
): Promise<Cart> {
  return apiFetch<Cart>(`/api/v1/cart/items/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: { quantity },
    signal,
  });
}

export async function removeCartItem(productId: string, signal?: AbortSignal): Promise<Cart> {
  return apiFetch<Cart>(`/api/v1/cart/items/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    signal,
  });
}

export async function clearCart(signal?: AbortSignal): Promise<Cart> {
  return apiFetch<Cart>('/api/v1/cart', { method: 'DELETE', signal });
}
