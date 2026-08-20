import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Cart } from '../api/cart';
import { renderWithProviders } from '../test/renderWithProviders';
import { CartPage } from './CartPage';

jest.mock('../api/cart', () => ({
  getCart: jest.fn(),
  updateCartItemQuantity: jest.fn(),
  removeCartItem: jest.fn(),
  clearCart: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

const cartApi = jest.requireMock('../api/cart') as {
  getCart: jest.Mock;
  updateCartItemQuantity: jest.Mock;
  removeCartItem: jest.Mock;
  clearCart: jest.Mock;
};

const { useAuth } = jest.requireMock('../auth/AuthContext') as { useAuth: jest.Mock };

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    userId: 'u-1',
    currency: 'USD',
    items: [],
    subtotalCents: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CartPage', () => {
  beforeEach(() => {
    cartApi.getCart.mockReset();
    cartApi.updateCartItemQuantity.mockReset();
    cartApi.removeCartItem.mockReset();
    cartApi.clearCart.mockReset();
    useAuth.mockReset();
    useAuth.mockReturnValue({
      isAuthenticated: true,
      user: { userId: 'u-1' },
      isInitializing: false,
    });
  });

  it('shows a loading state, then an empty-cart state with a browse link', async () => {
    cartApi.getCart.mockResolvedValueOnce(cart());
    renderWithProviders(<CartPage />, { route: '/cart' });

    expect(screen.getByText(/loading your cart/i)).toBeInTheDocument();

    expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse products/i })).toBeInTheDocument();
  });

  it('lists items, quantities, and the subtotal', async () => {
    cartApi.getCart.mockResolvedValueOnce(
      cart({
        items: [
          {
            productId: 'p-1',
            name: 'Trail Bottle',
            priceCents: 1000,
            currency: 'USD',
            quantity: 2,
            lineTotalCents: 2000,
            productAvailable: true,
            availableQuantity: 5,
          },
        ],
        subtotalCents: 2000,
      }),
    );
    renderWithProviders(<CartPage />, { route: '/cart' });

    expect(await screen.findByText('Trail Bottle')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Quantity for Trail Bottle$/i)).toHaveValue(2);
    const summary = screen.getByLabelText(/order summary/i);
    expect(within(summary).getByText('$20.00')).toBeInTheDocument();
  });

  it('updates a line quantity via the API', async () => {
    cartApi.getCart.mockResolvedValueOnce(
      cart({
        items: [
          {
            productId: 'p-1',
            name: 'Trail Bottle',
            priceCents: 1000,
            currency: 'USD',
            quantity: 2,
            lineTotalCents: 2000,
            productAvailable: true,
            availableQuantity: 5,
          },
        ],
        subtotalCents: 2000,
      }),
    );
    cartApi.updateCartItemQuantity.mockResolvedValueOnce(
      cart({
        items: [
          {
            productId: 'p-1',
            name: 'Trail Bottle',
            priceCents: 1000,
            currency: 'USD',
            quantity: 3,
            lineTotalCents: 3000,
            productAvailable: true,
            availableQuantity: 5,
          },
        ],
        subtotalCents: 3000,
      }),
    );
    renderWithProviders(<CartPage />, { route: '/cart' });

    await screen.findByText('Trail Bottle');
    await userEvent.click(
      screen.getByRole('button', { name: /increase quantity for trail bottle/i }),
    );

    expect(cartApi.updateCartItemQuantity).toHaveBeenCalledWith('p-1', 3);
    await waitFor(() =>
      expect(screen.getByLabelText(/^Quantity for Trail Bottle$/i)).toHaveValue(3),
    );
    const summary = screen.getByLabelText(/order summary/i);
    expect(within(summary).getByText('$30.00')).toBeInTheDocument();
  });

  it('removes a line via the API', async () => {
    cartApi.getCart.mockResolvedValueOnce(
      cart({
        items: [
          {
            productId: 'p-1',
            name: 'Trail Bottle',
            priceCents: 1000,
            currency: 'USD',
            quantity: 1,
            lineTotalCents: 1000,
            productAvailable: true,
            availableQuantity: 5,
          },
        ],
        subtotalCents: 1000,
      }),
    );
    cartApi.removeCartItem.mockResolvedValueOnce(cart());
    renderWithProviders(<CartPage />, { route: '/cart' });

    await screen.findByText('Trail Bottle');
    await userEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    expect(cartApi.removeCartItem).toHaveBeenCalledWith('p-1');
    expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument();
  });

  it('flags a line that is no longer available for purchase', async () => {
    cartApi.getCart.mockResolvedValueOnce(
      cart({
        items: [
          {
            productId: 'p-1',
            name: 'Discontinued Item',
            priceCents: 1000,
            currency: 'USD',
            quantity: 1,
            lineTotalCents: 0,
            productAvailable: false,
            availableQuantity: 0,
          },
        ],
        subtotalCents: 0,
      }),
    );
    renderWithProviders(<CartPage />, { route: '/cart' });

    await screen.findByText('Discontinued Item');
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it('clears the cart via the API', async () => {
    cartApi.getCart.mockResolvedValueOnce(
      cart({
        items: [
          {
            productId: 'p-1',
            name: 'Trail Bottle',
            priceCents: 1000,
            currency: 'USD',
            quantity: 1,
            lineTotalCents: 1000,
            productAvailable: true,
            availableQuantity: 5,
          },
        ],
        subtotalCents: 1000,
      }),
    );
    cartApi.clearCart.mockResolvedValueOnce(cart());
    renderWithProviders(<CartPage />, { route: '/cart' });

    await screen.findByText('Trail Bottle');
    await userEvent.click(screen.getByRole('button', { name: /clear cart/i }));

    expect(cartApi.clearCart).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument());
  });

  it('shows an error state with retry when the cart fails to load', async () => {
    cartApi.getCart.mockRejectedValueOnce(new Error('network down'));
    cartApi.getCart.mockResolvedValueOnce(cart());
    renderWithProviders(<CartPage />, { route: '/cart' });

    expect(await screen.findByText(/couldn't load your cart/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument();
  });
});
