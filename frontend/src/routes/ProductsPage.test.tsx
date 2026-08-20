import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '../api/httpClient';
import type { Product, ProductsPage as ProductsPageResult } from '../api/products';
import { renderWithProviders } from '../test/renderWithProviders';
import { ProductsPage } from './ProductsPage';

jest.mock('../api/products', () => ({
  listProducts: jest.fn(),
}));

const { listProducts } = jest.requireMock('../api/products') as { listProducts: jest.Mock };

function product(overrides: Partial<Product> = {}): Product {
  return {
    productId: '11111111-1111-4111-8111-111111111111',
    name: 'Trail Bottle',
    description: 'Insulated bottle',
    categoryId: 'drinkware',
    status: 'ACTIVE',
    priceCents: 2499,
    currency: 'USD',
    imageKeys: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function page(items: Product[], nextCursor: string | null = null): ProductsPageResult {
  return { items, nextCursor, limit: 12 };
}

describe('ProductsPage', () => {
  beforeEach(() => {
    listProducts.mockReset();
  });

  it('shows a loading state, then the product list', async () => {
    listProducts.mockResolvedValueOnce(page([product()]));
    renderWithProviders(<ProductsPage />, { route: '/products' });

    expect(screen.getByText(/loading products/i)).toBeInTheDocument();

    expect(await screen.findByText('Trail Bottle')).toBeInTheDocument();
    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 12 }),
      expect.anything(),
    );
  });

  it('shows an error state with a working retry button', async () => {
    listProducts.mockRejectedValueOnce(new ApiError('boom', 'NETWORK_ERROR', 0));
    listProducts.mockResolvedValueOnce(page([product()]));
    renderWithProviders(<ProductsPage />, { route: '/products' });

    expect(await screen.findByText(/couldn't load products/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Trail Bottle')).toBeInTheDocument();
    expect(listProducts).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when there are no products', async () => {
    listProducts.mockResolvedValueOnce(page([]));
    renderWithProviders(<ProductsPage />, { route: '/products' });

    expect(await screen.findByText(/no products found/i)).toBeInTheDocument();
  });

  it('filters the currently loaded page client-side by search term', async () => {
    listProducts.mockResolvedValueOnce(
      page([
        product({ name: 'Trail Bottle' }),
        product({ productId: '22222222-2222-4222-8222-222222222222', name: 'Camp Mug' }),
      ]),
    );
    renderWithProviders(<ProductsPage />, { route: '/products' });

    await screen.findByText('Trail Bottle');
    expect(screen.getByText('Camp Mug')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/search/i), 'mug');

    expect(screen.getByText('Camp Mug')).toBeInTheDocument();
    expect(screen.queryByText('Trail Bottle')).not.toBeInTheDocument();
  });

  it('requests the next cursor page and enables Previous once navigated forward', async () => {
    listProducts.mockResolvedValueOnce(page([product()], 'cursor-2'));
    listProducts.mockResolvedValueOnce(
      page(
        [product({ productId: '33333333-3333-4333-8333-333333333333', name: 'Second Page Item' })],
        null,
      ),
    );
    renderWithProviders(<ProductsPage />, { route: '/products' });

    await screen.findByText('Trail Bottle');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await screen.findByText('Second Page Item');
    expect(listProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-2' }),
      expect.anything(),
    );

    const previousButton = screen.getByRole('button', { name: /previous/i });
    await waitFor(() => expect(previousButton).toBeEnabled());
  });

  it('sends the category filter to the API', async () => {
    listProducts.mockResolvedValue(page([]));
    renderWithProviders(<ProductsPage />, { route: '/products' });
    await screen.findByText(/no products found/i);

    await userEvent.type(screen.getByLabelText(/category/i), 'drinkware');

    await waitFor(() =>
      expect(listProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: 'drinkware' }),
        expect.anything(),
      ),
    );
  });
});
