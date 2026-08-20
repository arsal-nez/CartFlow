import { useMemo, useState } from 'react';

import { EmptyState } from '../components/feedback/EmptyState';
import { ErrorState } from '../components/feedback/ErrorState';
import { LoadingState } from '../components/feedback/LoadingState';
import { PaginationControls } from '../components/PaginationControls';
import { ProductGrid } from '../components/ProductGrid';
import { useProductsQuery } from '../features/catalog/useProductsQuery';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const PAGE_SIZE = 12;

export function ProductsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const debouncedCategoryId = useDebouncedValue(categoryInput.trim(), 400);
  // Cursor pagination is forward-only from the API, so "Previous" replays the
  // stack of cursors already visited rather than asking the server for one.
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const currentCursor = cursorStack[cursorStack.length - 1];

  const query = useProductsQuery({
    categoryId: debouncedCategoryId === '' ? undefined : debouncedCategoryId,
    cursor: currentCursor,
    limit: PAGE_SIZE,
  });

  const visibleItems = useMemo(() => {
    const items = query.data?.items ?? [];
    const term = searchTerm.trim().toLowerCase();
    if (term === '') {
      return items;
    }
    return items.filter(
      (product) =>
        product.name.toLowerCase().includes(term) ||
        product.description.toLowerCase().includes(term),
    );
  }, [query.data, searchTerm]);

  const resetToFirstPage = () => setCursorStack([undefined]);

  return (
    <div className="page-container">
      <h1>Products</h1>

      <form className="toolbar" role="search" onSubmit={(event) => event.preventDefault()}>
        <div className="field">
          <label htmlFor="product-search">Search</label>
          <input
            id="product-search"
            type="search"
            placeholder="Search loaded products by name or description"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="product-category">Category</label>
          <input
            id="product-category"
            type="text"
            placeholder="e.g. drinkware"
            value={categoryInput}
            onChange={(event) => {
              setCategoryInput(event.target.value);
              resetToFirstPage();
            }}
          />
        </div>
      </form>

      {query.isPending && <LoadingState label="Loading products…" />}

      {query.isError && (
        <ErrorState
          error={query.error}
          title="Couldn't load products"
          onRetry={() => void query.refetch()}
        />
      )}

      {query.isSuccess && visibleItems.length === 0 && (
        <EmptyState
          title={searchTerm.trim() === '' ? 'No products found' : 'No matches on this page'}
          description={
            searchTerm.trim() === ''
              ? debouncedCategoryId === ''
                ? 'There are no active products yet.'
                : `No active products in category "${debouncedCategoryId}".`
              : 'Search only filters the products already loaded on this page — try clearing it or browsing another page.'
          }
        />
      )}

      {query.isSuccess && visibleItems.length > 0 && <ProductGrid products={visibleItems} />}

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
