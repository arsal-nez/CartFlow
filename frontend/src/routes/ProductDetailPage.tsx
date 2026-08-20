import { Link, useParams } from 'react-router-dom';

// From `httpClient.ts`, not `client.ts` — see the comment in `ErrorState.tsx`.
import { ApiError } from '../api/httpClient';
import { EmptyState } from '../components/feedback/EmptyState';
import { ErrorState } from '../components/feedback/ErrorState';
import { LoadingState } from '../components/feedback/LoadingState';
import { Money } from '../components/Money';
import { ProductImage } from '../components/ProductImage';
import { StockBadge } from '../components/StockBadge';
import { AddToCartControl } from '../features/cart/AddToCartControl';
import { useProductQuery, useProductStockQuery } from '../features/catalog/useProductQuery';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();

  const productQuery = useProductQuery(id);
  const stockQuery = useProductStockQuery(id);

  if (id === undefined) {
    return (
      <div className="page-container">
        <EmptyState title="Product not found" description="No product id was provided." />
      </div>
    );
  }

  if (productQuery.isPending) {
    return (
      <div className="page-container">
        <LoadingState label="Loading product…" />
      </div>
    );
  }

  if (productQuery.isError) {
    const notFound = productQuery.error instanceof ApiError && productQuery.error.status === 404;
    return (
      <div className="page-container">
        {notFound ? (
          <EmptyState
            title="Product not found"
            description="It may have been removed or is no longer available."
            action={
              <Link to="/products" className="btn btn-secondary">
                Back to products
              </Link>
            }
          />
        ) : (
          <ErrorState
            error={productQuery.error}
            title="Couldn't load this product"
            onRetry={() => void productQuery.refetch()}
          />
        )}
      </div>
    );
  }

  const product = productQuery.data;

  return (
    <div className="page-container">
      <div className="product-detail">
        <ProductImage
          name={product.name}
          imageKeys={product.imageKeys}
          className="product-detail__image"
        />

        <div>
          <h1>{product.name}</h1>

          {stockQuery.isSuccess && <StockBadge stock={stockQuery.data} />}

          <p className="product-detail__price">
            <Money cents={product.priceCents} currency={product.currency} />
          </p>

          <p>{product.description === '' ? 'No description provided.' : product.description}</p>

          {stockQuery.isPending && <LoadingState label="Checking stock…" />}
          {stockQuery.isError && (
            <ErrorState
              error={stockQuery.error}
              title="Couldn't check stock"
              onRetry={() => void stockQuery.refetch()}
            />
          )}
          {stockQuery.isSuccess && (
            <AddToCartControl productId={product.productId} stock={stockQuery.data} />
          )}
        </div>
      </div>
    </div>
  );
}
