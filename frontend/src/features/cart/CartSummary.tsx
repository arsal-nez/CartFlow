import type { Cart } from '../../api/cart';
import { Money } from '../../components/Money';

export function CartSummary({ cart }: { cart: Cart }) {
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const hasUnavailableItems = cart.items.some((item) => !item.productAvailable);

  return (
    <aside className="card cart-summary" aria-label="Order summary">
      <h2>Summary</h2>
      <div className="cart-summary__row">
        <span>Items</span>
        <span>{itemCount}</span>
      </div>
      <div className="cart-summary__row cart-summary__row--total">
        <span>Subtotal</span>
        <span>
          <Money cents={cart.subtotalCents} currency={cart.currency} />
        </span>
      </div>
      {hasUnavailableItems && (
        <p className="field-hint">
          Unavailable items are excluded from your subtotal. Remove them to check out.
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled
        title="Checkout is not available yet"
      >
        Proceed to checkout
      </button>
    </aside>
  );
}
