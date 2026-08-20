import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { Product, ProductStatus } from '../../api/products';
import { AdminNav } from '../../components/admin/AdminNav';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Money } from '../../components/Money';
import { PaginationControls } from '../../components/PaginationControls';
import {
  useAdminProductsQuery,
  useDeleteProductMutation,
} from '../../features/admin/useAdminProducts';

const STATUS_TABS: ProductStatus[] = ['ACTIVE', 'DRAFT', 'ARCHIVED'];
const PAGE_SIZE = 20;

function StatusTabs({
  status,
  onChange,
}: {
  status: ProductStatus;
  onChange: (next: ProductStatus) => void;
}) {
  return (
    <div className="toolbar" role="tablist" aria-label="Filter by status">
      {STATUS_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={status === tab}
          className={status === tab ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function ProductRow({ product }: { product: Product }) {
  const deleteMutation = useDeleteProductMutation();
  const canArchive = product.status !== 'ARCHIVED';

  return (
    <tr>
      <td>
        <strong>{product.name}</strong>
      </td>
      <td>{product.categoryId}</td>
      <td>
        <Money cents={product.priceCents} currency={product.currency} />
      </td>
      <td>
        <span className={`badge badge-${product.status === 'ACTIVE' ? 'success' : 'warning'}`}>
          {product.status}
        </span>
      </td>
      <td className="admin-table__actions">
        <Link to={`/admin/products/${product.productId}/edit`} className="btn btn-secondary btn-sm">
          Edit
        </Link>
        {canArchive && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(`Archive "${product.name}"? It will no longer be sold.`)) {
                deleteMutation.mutate(product.productId);
              }
            }}
          >
            {deleteMutation.isPending ? 'Archiving…' : 'Archive'}
          </button>
        )}
      </td>
    </tr>
  );
}

export function AdminProductsPage() {
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
      <div className="section-heading">
        <h1>Products</h1>
        <Link to="/admin/products/new" className="btn btn-primary">
          New product
        </Link>
      </div>
      <AdminNav />

      <StatusTabs status={status} onChange={changeStatus} />

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
          description={
            status === 'DRAFT'
              ? 'New products start as drafts until you activate them.'
              : `There are no ${status.toLowerCase()} products yet.`
          }
        />
      )}

      {query.isSuccess && query.data.items.length > 0 && (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((product) => (
                <ProductRow key={product.productId} product={product} />
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
