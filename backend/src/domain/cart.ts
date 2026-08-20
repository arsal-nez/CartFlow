export interface CartItem {
  userId: string;
  productId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface Cart {
  userId: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  items: CartItem[];
}

export interface CreateCartInput {
  userId: string;
  currency?: string;
}

export interface CartItemInput {
  productId: string;
  /** `0` removes the line from the cart. */
  quantity: number;
}

export interface UpdateCartInput {
  userId: string;
  /** Full replacement of the cart contents. */
  items: CartItemInput[];
  /** Optimistic concurrency guard against the cart header's `updatedAt`. */
  expectedUpdatedAt?: string;
}
