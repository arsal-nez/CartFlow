import type { CartService } from '../../../src/services/cart.service';

export interface FakeCartService {
  service: CartService;
  getCart: jest.Mock;
  addItem: jest.Mock;
  updateItemQuantity: jest.Mock;
  removeItem: jest.Mock;
  clearCart: jest.Mock;
}

/** A `CartService` stand-in for handler tests — no repository, no AWS SDK involved. */
export function createFakeCartService(): FakeCartService {
  const getCart = jest.fn();
  const addItem = jest.fn();
  const updateItemQuantity = jest.fn();
  const removeItem = jest.fn();
  const clearCart = jest.fn();

  return {
    service: { getCart, addItem, updateItemQuantity, removeItem, clearCart },
    getCart,
    addItem,
    updateItemQuantity,
    removeItem,
    clearCart,
  };
}
