import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Product, ProductStock } from '../api/products';
import { ApiError } from '../api/httpClient';
import { renderWithProviders } from '../test/renderWithProviders';
import { ProductDetailPage } from './ProductDetailPage';

jest.mock('../api/products', () => ({
  getProduct: jest.fn(),
  getProductStock: jest.fn(),
}));
jest.mock('../api/cart', () => ({
  addCartItem: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

const { getProduct, getProductStock } = jest.requireMock('../api/products') as {
  getProduct: jest.Mock;
  getProductStock: jest.Mock;
};

const { addCartItem } = jest.requireMock('../api/cart') as { addCartItem: jest.Mock };

const { useAuth } = jest.requireMock('../auth/AuthContext') as { useAuth: jest.Mock };

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const SAMPLE_PRODUCT: Product = {
  productId: PRODUCT_ID,
  name: 'Trail Bottle',
  description: 'An insulated bottle for the trail.',
  categoryId: 'drinkware',
  status: 'ACTIVE',
  priceCents: 2499,
  currency: 'USD',
  imageKeys: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function stock(overrides: Partial<ProductStock> = {}): ProductStock {
  return { productId: PRODUCT_ID, availableQuantity: 10, stockStatus: 'IN_STOCK', ...overrides };
}

function renderDetail() {
  return renderWithProviders(<ProductDetailPage />, {
    route: `/products/${PRODUCT_ID}`,
    path: '/products/:id',
  });
}

describe('ProductDetailPage', () => {
  beforeEach(() => {
    getProduct.mockReset();
    getProductStock.mockReset();
    addCartItem.mockReset();
    useAuth.mockReset();
    useAuth.mockReturnValue({ isAuthenticated: false, user: null, isInitializing: false });
    // The stock query fires unconditionally once `id` is defined (it's a
    // second, independent hook) — give it a harmless default so tests that
    // only care about the product query don't hit an unmocked call.
    getProductStock.mockResolvedValue(stock());
  });

  it('shows image, title, description, price, and stock once loaded', async () => {
    getProduct.mockResolvedValueOnce(SAMPLE_PRODUCT);
    getProductStock.mockResolvedValueOnce(stock({ availableQuantity: 3, stockStatus: 'LOW' }));
    renderDetail();

    expect(screen.getByText(/loading product/i)).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Trail Bottle' })).toBeInTheDocument();
    expect(screen.getByText('An insulated bottle for the trail.')).toBeInTheDocument();
    expect(screen.getByText('$24.99')).toBeInTheDocument();
    expect(screen.getByText(/only 3 left/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /trail bottle/i })).toBeInTheDocument();
  });

  it('shows a friendly "Product not found" state on a 404, not a generic error', async () => {
    getProduct.mockRejectedValueOnce(new ApiError('Product not found', 'NOT_FOUND', 404));
    renderDetail();

    expect(await screen.findByText(/product not found/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to products/i })).toBeInTheDocument();
  });

  it('shows a generic error state (with retry) for a non-404 failure', async () => {
    getProduct.mockRejectedValueOnce(new ApiError('Server exploded', 'INTERNAL_ERROR', 500));
    getProduct.mockResolvedValueOnce(SAMPLE_PRODUCT);
    getProductStock.mockResolvedValue(stock());
    renderDetail();

    expect(await screen.findByText(/couldn't load this product/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('heading', { name: 'Trail Bottle' })).toBeInTheDocument();
  });

  it('shows a login prompt instead of an add-to-cart control when signed out', async () => {
    getProduct.mockResolvedValueOnce(SAMPLE_PRODUCT);
    getProductStock.mockResolvedValueOnce(stock());
    renderDetail();

    await screen.findByRole('heading', { name: 'Trail Bottle' });
    expect(screen.getByRole('link', { name: /log in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument();
  });

  it('adds the product to the cart when signed in', async () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      user: { userId: 'u-1' },
      isInitializing: false,
    });
    getProduct.mockResolvedValueOnce(SAMPLE_PRODUCT);
    getProductStock.mockResolvedValueOnce(stock({ availableQuantity: 10 }));
    addCartItem.mockResolvedValueOnce({
      userId: 'u-1',
      currency: 'USD',
      items: [],
      subtotalCents: 0,
      updatedAt: null,
    });
    renderDetail();

    await screen.findByRole('heading', { name: 'Trail Bottle' });
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(await screen.findByText(/added to cart/i)).toBeInTheDocument();
    expect(addCartItem).toHaveBeenCalledWith({ productId: PRODUCT_ID, quantity: 1 });
  });

  it('disables Add to cart for an out-of-stock product', async () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      user: { userId: 'u-1' },
      isInitializing: false,
    });
    getProduct.mockResolvedValueOnce(SAMPLE_PRODUCT);
    getProductStock.mockResolvedValueOnce(
      stock({ availableQuantity: 0, stockStatus: 'OUT_OF_STOCK' }),
    );
    renderDetail();

    await screen.findByRole('heading', { name: 'Trail Bottle' });
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeDisabled();
  });
});
