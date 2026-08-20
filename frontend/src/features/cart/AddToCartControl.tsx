import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { ProductStock } from '../../api/products';
import { describeError } from '../../components/feedback/ErrorState';
import { QuantityInput } from '../../components/QuantityInput';
import { useAuth } from '../../auth/AuthContext';
import { useAddCartItemMutation } from './useCart';

export function AddToCartControl({ productId, stock }: { productId: string; stock: ProductStock }) {
  const { isAuthenticated } = useAuth();
  const [quantity, setQuantity] = useState(1);
  const mutation = useAddCartItemMutation();
  const outOfStock = stock.availableQuantity <= 0;

  if (!isAuthenticated) {
    return (
      <p className="field-hint">
        <Link to="/login">Log in</Link> to add this item to your cart.
      </p>
    );
  }

  return (
    <div className="form" aria-label="Add to cart">
      <div className="cart-line__row">
        <QuantityInput
          aria-label="Quantity to add"
          value={quantity}
          max={Math.max(stock.availableQuantity, 1)}
          disabled={outOfStock || mutation.isPending}
          onChange={setQuantity}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={outOfStock || mutation.isPending}
          onClick={() => {
            mutation.reset();
            mutation.mutate({ productId, quantity });
          }}
        >
          {mutation.isPending ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
      {mutation.isSuccess && !mutation.isPending && (
        <p className="badge badge-success" role="status">
          Added to cart
        </p>
      )}
      {mutation.isError && (
        <p className="field-error" role="alert">
          {describeError(mutation.error)}
        </p>
      )}
    </div>
  );
}
