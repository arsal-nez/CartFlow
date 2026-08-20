import { Link } from 'react-router-dom';

import { useProductsQuery } from '../features/catalog/useProductsQuery';
import { EmptyState } from '../components/feedback/EmptyState';
import { ErrorState } from '../components/feedback/ErrorState';
import { LoadingState } from '../components/feedback/LoadingState';
import { ProductGrid } from '../components/ProductGrid';

const FEATURED_LIMIT = 4;

export function HomePage() {
  const featuredQuery = useProductsQuery({ limit: FEATURED_LIMIT });

  return (
    <div className="page-container">
      <section className="hero">
        <h1>Everything you need, shipped fast.</h1>
        <p>Browse the CartFlow catalog and check out with confidence.</p>
        <Link to="/products" className="btn btn-primary">
          Shop all products
        </Link>
      </section>

      <section>
        <div className="section-heading">
          <h2>Featured products</h2>
          <Link to="/products">View all</Link>
        </div>

        {featuredQuery.isPending && <LoadingState label="Loading featured products…" />}

        {featuredQuery.isError && (
          <ErrorState
            error={featuredQuery.error}
            title="Couldn't load featured products"
            onRetry={() => void featuredQuery.refetch()}
          />
        )}

        {featuredQuery.isSuccess && featuredQuery.data.items.length === 0 && (
          <EmptyState title="No products yet" description="Check back soon." />
        )}

        {featuredQuery.isSuccess && featuredQuery.data.items.length > 0 && (
          <ProductGrid products={featuredQuery.data.items} />
        )}
      </section>
    </div>
  );
}
