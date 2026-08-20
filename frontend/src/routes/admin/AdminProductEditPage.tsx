import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { AdminNav } from '../../components/admin/AdminNav';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ProductForm, type ProductFormSubmitValues } from '../../features/admin/ProductForm';
import { useUpdateProductMutation } from '../../features/admin/useAdminProducts';
import { useProductQuery } from '../../features/catalog/useProductQuery';

export function AdminProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const productQuery = useProductQuery(id);
  const updateMutation = useUpdateProductMutation(id ?? '');
  const [submitError, setSubmitError] = useState<unknown>(null);

  if (id === undefined) {
    return (
      <div className="page-container">
        <EmptyState title="Product not found" description="No product id was provided." />
      </div>
    );
  }

  const handleSubmit = async (values: ProductFormSubmitValues) => {
    setSubmitError(null);
    try {
      await updateMutation.mutateAsync(values);
      navigate('/admin/products');
    } catch (error) {
      setSubmitError(error);
    }
  };

  return (
    <div className="page-container">
      <h1>Edit product</h1>
      <AdminNav />

      {productQuery.isPending && <LoadingState label="Loading product…" />}

      {productQuery.isError && (
        <ErrorState
          error={productQuery.error}
          title="Couldn't load this product"
          onRetry={() => void productQuery.refetch()}
        />
      )}

      {productQuery.isSuccess && (
        <div className="card admin-form-card">
          <ProductForm
            initialProduct={productQuery.data}
            onSubmit={handleSubmit}
            submitLabel="Save changes"
            submitError={submitError}
          />
        </div>
      )}

      <p>
        <Link to="/admin/inventory">Manage stock for this product →</Link>
      </p>
    </div>
  );
}
