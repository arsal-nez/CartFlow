import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import type { Product, ProductStatus } from '../../api/products';
import { ImageUploadField } from '../../components/admin/ImageUploadField';
import { InlineError } from '../../components/feedback/ErrorState';
import { TextField } from '../../components/form/TextField';
import { useKnownCategoriesQuery } from './useKnownCategories';
import {
  centsToPriceInput,
  priceInputToCents,
  productFormSchema,
  type ProductFormValues,
} from './productFormSchema';

export interface ProductFormSubmitValues {
  name: string;
  description: string;
  categoryId: string;
  priceCents: number;
  currency: string;
  status: ProductStatus;
  imageKeys: string[];
}

export interface ProductFormProps {
  /** Omit for the "new product" form; pass the current product for "edit". */
  initialProduct?: Product | undefined;
  onSubmit: (values: ProductFormSubmitValues) => Promise<void>;
  submitLabel: string;
  submitError: unknown;
}

export function ProductForm({
  initialProduct,
  onSubmit,
  submitLabel,
  submitError,
}: ProductFormProps) {
  const categoriesQuery = useKnownCategoriesQuery();
  const [imageKeys, setImageKeys] = useState<string[]>(initialProduct?.imageKeys ?? []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues:
      initialProduct === undefined
        ? { name: '', description: '', categoryId: '', price: '', currency: 'USD', status: 'DRAFT' }
        : {
            name: initialProduct.name,
            description: initialProduct.description,
            categoryId: initialProduct.categoryId,
            price: centsToPriceInput(initialProduct.priceCents),
            currency: initialProduct.currency,
            status: initialProduct.status,
          },
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      name: values.name,
      description: values.description,
      categoryId: values.categoryId,
      priceCents: priceInputToCents(values.price),
      currency: values.currency,
      status: values.status,
      imageKeys,
    });
  });

  const productNameForPreview = initialProduct?.name ?? 'New product';

  return (
    <form className="form admin-form" onSubmit={(event) => void submit(event)} noValidate>
      <TextField label="Name" registration={register('name')} error={errors.name?.message} />

      <div className="field">
        <label htmlFor="field-description">Description</label>
        <textarea id="field-description" rows={5} {...register('description')} />
        {errors.description?.message !== undefined && (
          <span className="field-error" role="alert">
            {errors.description.message}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="field-categoryId">Category</label>
        <input
          id="field-categoryId"
          type="text"
          list="admin-known-categories"
          placeholder="e.g. drinkware"
          {...register('categoryId')}
        />
        <datalist id="admin-known-categories">
          {(categoriesQuery.data ?? []).map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        {errors.categoryId?.message !== undefined ? (
          <span className="field-error" role="alert">
            {errors.categoryId.message}
          </span>
        ) : (
          <span className="field-hint">
            Pick an existing category or type a new one — CartFlow categories aren&apos;t a separate
            list, they&apos;re whatever active products use.
          </span>
        )}
      </div>

      <div className="admin-form__row">
        <TextField
          label="Price"
          placeholder="19.99"
          registration={register('price')}
          error={errors.price?.message}
        />
        <TextField
          label="Currency"
          placeholder="USD"
          registration={register('currency')}
          error={errors.currency?.message}
        />
      </div>

      <div className="field">
        <label htmlFor="field-status">Status</label>
        <select id="field-status" {...register('status')}>
          <option value="DRAFT">Draft — hidden from the storefront</option>
          <option value="ACTIVE">Active — visible in the storefront</option>
          <option value="ARCHIVED">Archived — soft-deleted</option>
        </select>
      </div>

      <ImageUploadField
        productName={productNameForPreview}
        imageKeys={imageKeys}
        onChange={setImageKeys}
      />

      {submitError !== null && submitError !== undefined && <InlineError error={submitError} />}

      <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
