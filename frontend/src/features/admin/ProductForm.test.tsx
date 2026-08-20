import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';

import type { Product } from '../../api/products';
import { createTestQueryClient } from '../../test/renderWithProviders';
import { ProductForm } from './ProductForm';

// The image upload flow (presigned URL + S3 PUT) is its own unit; stubbed
// here so this file can focus on the form's own validation and submission.
jest.mock('../../components/admin/ImageUploadField', () => ({
  ImageUploadField: () => <div data-testid="image-upload-field-stub" />,
}));
jest.mock('./useKnownCategories', () => ({
  useKnownCategoriesQuery: () => ({ data: ['drinkware', 'outerwear'] }),
}));

function renderForm(props: Partial<ComponentProps<typeof ProductForm>> = {}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductForm
        onSubmit={props.onSubmit ?? jest.fn().mockResolvedValue(undefined)}
        submitLabel={props.submitLabel ?? 'Create product'}
        submitError={props.submitError ?? null}
        initialProduct={props.initialProduct}
      />
    </QueryClientProvider>,
  );
}

const EXISTING_PRODUCT: Product = {
  productId: '11111111-1111-4111-8111-111111111111',
  name: 'Trail Bottle',
  description: 'Insulated bottle',
  categoryId: 'drinkware',
  status: 'ACTIVE',
  priceCents: 2499,
  currency: 'USD',
  imageKeys: ['products/abc.jpg'],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('ProductForm', () => {
  it('starts blank, defaulting status to Draft, for a new product', () => {
    renderForm();

    expect(screen.getByLabelText(/^name$/i)).toHaveValue('');
    expect(screen.getByLabelText(/currency/i)).toHaveValue('USD');
    expect(screen.getByLabelText(/status/i)).toHaveValue('DRAFT');
  });

  it('prefills every field from the initial product when editing', () => {
    renderForm({ initialProduct: EXISTING_PRODUCT });

    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Trail Bottle');
    expect(screen.getByLabelText(/^price/i)).toHaveValue('24.99');
    expect(screen.getByLabelText(/currency/i)).toHaveValue('USD');
    expect(screen.getByLabelText(/status/i)).toHaveValue('ACTIVE');
    expect(screen.getByLabelText(/category/i)).toHaveValue('drinkware');
  });

  it('rejects submission with an invalid (non-numeric) price and never calls onSubmit', async () => {
    const onSubmit = jest.fn();
    renderForm({ onSubmit });

    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await userEvent.type(screen.getByLabelText(/category/i), 'drinkware');
    await userEvent.type(screen.getByLabelText(/^price/i), 'not-a-price');
    await userEvent.type(screen.getByLabelText(/currency/i), 'USD');
    await userEvent.click(screen.getByRole('button', { name: /create product/i }));

    expect(await screen.findByText(/enter a price like 19\.99/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a zero price', async () => {
    const onSubmit = jest.fn();
    renderForm({ onSubmit });

    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await userEvent.type(screen.getByLabelText(/category/i), 'drinkware');
    await userEvent.type(screen.getByLabelText(/^price/i), '0');
    await userEvent.type(screen.getByLabelText(/currency/i), 'USD');
    await userEvent.click(screen.getByRole('button', { name: /create product/i }));

    expect(await screen.findByText(/price must be greater than zero/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits priceCents converted from the dollar input, on a valid form', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    renderForm({ onSubmit });

    await userEvent.type(screen.getByLabelText(/^name$/i), 'New Product');
    await userEvent.type(screen.getByLabelText(/category/i), 'drinkware');
    await userEvent.type(screen.getByLabelText(/^price/i), '19.99');
    await userEvent.clear(screen.getByLabelText(/currency/i));
    await userEvent.type(screen.getByLabelText(/currency/i), 'usd');
    await userEvent.selectOptions(screen.getByLabelText(/status/i), 'ACTIVE');
    await userEvent.click(screen.getByRole('button', { name: /create product/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Product',
        categoryId: 'drinkware',
        priceCents: 1999,
        currency: 'USD',
        status: 'ACTIVE',
        imageKeys: [],
      }),
    );
  });

  it('shows the submit error passed in from the page (e.g. a 409 from a concurrent edit)', () => {
    renderForm({ submitError: new Error('Product was modified concurrently') });

    expect(screen.getByText(/product was modified concurrently/i)).toBeInTheDocument();
  });
});
