import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AdminNav } from '../../components/admin/AdminNav';
import { ProductForm, type ProductFormSubmitValues } from '../../features/admin/ProductForm';
import { useCreateProductMutation } from '../../features/admin/useAdminProducts';

export function AdminProductNewPage() {
  const navigate = useNavigate();
  const createMutation = useCreateProductMutation();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const handleSubmit = async (values: ProductFormSubmitValues) => {
    setSubmitError(null);
    try {
      const product = await createMutation.mutateAsync(values);
      navigate(`/admin/products/${product.productId}/edit`, { replace: true });
    } catch (error) {
      setSubmitError(error);
    }
  };

  return (
    <div className="page-container">
      <h1>New product</h1>
      <AdminNav />
      <div className="card admin-form-card">
        <ProductForm
          onSubmit={handleSubmit}
          submitLabel="Create product"
          submitError={submitError}
        />
      </div>
    </div>
  );
}
