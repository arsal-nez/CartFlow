import type { CartLine } from '../../api/cart';
import { describeError } from '../../components/feedback/ErrorState';
import { Money } from '../../components/Money';
import { ProductImage } from '../../components/ProductImage';
import { QuantityInput } from '../../components/QuantityInput';
import { useRemoveCartItemMutation, useUpdateCartItemMutation } from './useCart';

export function CartLineRow({ line }: { line: CartLine }) {
  const updateMutation = useUpdateCartItemMutation();
  const removeMutation = useRemoveCartItemMutation();
  const isBusy = updateMutation.isPending || removeMutation.isPending;

  return (
    <div className="cart-line">
      <ProductImage name={line.name} imageKeys={[]} className="cart-line__image" />
      <div className="cart-line__body">
        <div className="cart-line__row">
          <strong>{line.name}</strong>
          <strong>
            <Money cents={line.lineTotalCents} currency={line.currency} />
          </strong>
        </div>

        {!line.productAvailable && (
          <span className="badge badge-danger">No longer available for purchase</span>
        )}

        <div className="cart-line__row">
          <QuantityInput
            aria-label={`Quantity for ${line.name}`}
            value={line.quantity}
            max={line.productAvailable ? Math.max(line.availableQuantity, 1) : line.quantity}
            disabled={isBusy || !line.productAvailable}
            onChange={(quantity) => {
              updateMutation.mutate({ productId: line.productId, quantity });
            }}
          />
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={isBusy}
            onClick={() => removeMutation.mutate(line.productId)}
          >
            Remove
          </button>
        </div>

        <span className="field-hint">
          <Money cents={line.priceCents} currency={line.currency} /> each
        </span>

        {(updateMutation.isError || removeMutation.isError) && (
          <span className="field-error" role="alert">
            {describeError(updateMutation.error ?? removeMutation.error)}
          </span>
        )}
      </div>
    </div>
  );
}
