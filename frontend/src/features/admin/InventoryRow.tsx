import { useEffect, useState } from 'react';

import type { Product } from '../../api/products';
import { describeError } from '../../components/feedback/ErrorState';
import { InlineSpinner } from '../../components/feedback/LoadingState';
import { StockBadge } from '../../components/StockBadge';
import { useAdminStockQuery, useUpdateStockMutation } from './useAdminInventory';

/**
 * One row of the `/admin/inventory` table: its own stock query and its own
 * update mutation, so editing one product's stock never disturbs another
 * row's pending/error state (same pattern as `CartLineRow`).
 */
export function InventoryRow({ product }: { product: Product }) {
  const stockQuery = useAdminStockQuery(product.productId);
  const updateMutation = useUpdateStockMutation(product.productId);

  const [availableQuantity, setAvailableQuantity] = useState('');
  const [reorderThreshold, setReorderThreshold] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (stockQuery.data !== undefined && !isEditing) {
      setAvailableQuantity(String(stockQuery.data.availableQuantity));
      setReorderThreshold(String(stockQuery.data.reorderThreshold));
    }
  }, [stockQuery.data, isEditing]);

  if (stockQuery.isPending) {
    return (
      <tr>
        <td>{product.name}</td>
        <td colSpan={4}>
          <InlineSpinner label={`Loading stock for ${product.name}`} />
        </td>
      </tr>
    );
  }

  if (stockQuery.isError) {
    return (
      <tr>
        <td>{product.name}</td>
        <td colSpan={4} className="field-error">
          {describeError(stockQuery.error)}
        </td>
      </tr>
    );
  }

  const stock = stockQuery.data;

  const handleSave = () => {
    const parsedAvailable = Number.parseInt(availableQuantity, 10);
    const parsedThreshold = Number.parseInt(reorderThreshold, 10);
    if (!Number.isInteger(parsedAvailable) || parsedAvailable < 0) {
      return;
    }
    if (!Number.isInteger(parsedThreshold) || parsedThreshold < 0) {
      return;
    }
    updateMutation.mutate(
      { availableQuantity: parsedAvailable, reorderThreshold: parsedThreshold },
      { onSuccess: () => setIsEditing(false) },
    );
  };

  return (
    <tr>
      <td>
        <strong>{product.name}</strong>
        <div className="field-hint">{product.categoryId}</div>
      </td>
      <td>
        <StockBadge stock={stock} />
      </td>
      <td>
        {isEditing ? (
          <input
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={`Available quantity for ${product.name}`}
            value={availableQuantity}
            onChange={(event) => setAvailableQuantity(event.target.value)}
          />
        ) : (
          stock.availableQuantity
        )}
      </td>
      <td>
        {isEditing ? (
          <input
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={`Reorder threshold for ${product.name}`}
            value={reorderThreshold}
            onChange={(event) => setReorderThreshold(event.target.value)}
          />
        ) : (
          stock.reorderThreshold
        )}
      </td>
      <td className="admin-table__actions">
        {isEditing ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={updateMutation.isPending}
              onClick={handleSave}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={updateMutation.isPending}
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsEditing(true)}
          >
            Edit stock
          </button>
        )}
        {updateMutation.isError && (
          <span className="field-error" role="alert">
            {describeError(updateMutation.error)}
          </span>
        )}
      </td>
    </tr>
  );
}
