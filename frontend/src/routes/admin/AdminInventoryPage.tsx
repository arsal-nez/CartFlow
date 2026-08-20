import { useState } from 'react';

import type { ProductStatus } from '../../api/products';
import { AdminNav } from '../../components/admin/AdminNav';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { PaginationControls } from '../../components/PaginationControls';
import { useAdminProductsQuery } from '../../features/admin/useAdminProducts';
import { InventoryRow } from '../../features/admin/InventoryRow';

const PAGE_SIZE = 20;
// Only ACTIVE/DRAFT products are worth stocking — an archived product has
// been soft-deleted from the catalog, so its inventory isn't operationally
// relevant here.
const STATUS_TABS: ProductStatus[] = ['ACTIVE', 'DRAFT'];

export function AdminInventoryPage() {
  const [status, setStatus] = useState<ProductStatus>('ACTIVE');
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const currentCursor = cursorStack[cursorStack.length - 1];

  const query = useAdminProductsQuery({ status, cursor: currentCursor, limit: PAGE_SIZE });

  const changeStatus = (next: ProductStatus) => {
    setStatus(next);
    setCursorStack([undefined]);
  };

  return (
    <div className="page-container">
      <h1>Inventory</h1>
      <AdminNav />

      <div className="toolbar" role="tablist" aria-label="Filter by status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={status === tab}
            className={status === tab ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            onClick={() => changeStatus(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {query.isPending && <LoadingState label="Loading products…" />}

      {query.isError && (
        <ErrorState
          error={query.error}
          title="Couldn't load products"
          onRetry={() => void query.refetch()}
        />
      )}

      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState
          title={`No ${status.toLowerCase()} products`}
          description="Nothing to stock in this view yet."
        />
      )}

      {query.isSuccess && query.data.items.length > 0 && (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Status</th>
                <th>Available</th>
                <th>Reorder threshold</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((product) => (
                <InventoryRow key={product.productId} product={product} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.isSuccess && (
        <PaginationControls
          hasPrevious={cursorStack.length > 1}
          hasNext={query.data.nextCursor !== null}
          disabled={query.isFetching}
          onPrevious={() =>
            setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack))
          }
          onNext={() => {
            const next = query.data.nextCursor;
            if (next !== null) {
              setCursorStack((stack) => [...stack, next]);
            }
          }}
        />
      )}
    </div>
  );
}
