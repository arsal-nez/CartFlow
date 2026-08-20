import { Link } from 'react-router-dom';

import { EmptyState } from '../components/feedback/EmptyState';
import { ErrorState } from '../components/feedback/ErrorState';
import { LoadingState } from '../components/feedback/LoadingState';
import { CartLineRow } from '../features/cart/CartLineRow';
import { CartSummary } from '../features/cart/CartSummary';
import { useCartQuery, useClearCartMutation } from '../features/cart/useCart';

export function CartPage() {
  const cartQuery = useCartQuery();
  const clearMutation = useClearCartMutation();

  return (
    <div className="page-container">
      <div className="section-heading">
        <h1>Your cart</h1>
        {cartQuery.data !== undefined && cartQuery.data.items.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={clearMutation.isPending}
            onClick={() => clearMutation.mutate()}
          >
            {clearMutation.isPending ? 'Clearing…' : 'Clear cart'}
          </button>
        )}
      </div>

      {cartQuery.isPending && <LoadingState label="Loading your cart…" />}

      {cartQuery.isError && (
        <ErrorState
          error={cartQuery.error}
          title="Couldn't load your cart"
          onRetry={() => void cartQuery.refetch()}
        />
      )}

      {cartQuery.isSuccess && cartQuery.data.items.length === 0 && (
        <EmptyState
          icon="🛒"
          title="Your cart is empty"
          description="Add a few products to get started."
          action={
            <Link to="/products" className="btn btn-primary">
              Browse products
            </Link>
          }
        />
      )}

      {cartQuery.isSuccess && cartQuery.data.items.length > 0 && (
        <div className="cart-layout">
          <div className="card">
            {cartQuery.data.items.map((line) => (
              <CartLineRow key={line.productId} line={line} />
            ))}
          </div>
          <CartSummary cart={cartQuery.data} />
        </div>
      )}
    </div>
  );
}
