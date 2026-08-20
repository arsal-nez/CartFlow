import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Shared render helper for component tests. `retry: false` and `gcTime: 0`
 * keep failed/pending queries deterministic and fast — the app's real
 * `QueryClient` (see `main.tsx`) retries once and caches, which would make
 * error-path and refetch assertions flaky and slow in tests.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function withProviders(
  children: ReactNode,
  initialEntries: string[],
  queryClient?: QueryClient,
) {
  const client = queryClient ?? createTestQueryClient();
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={initialEntries}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

export interface RenderWithProvidersOptions {
  /** The URL the memory router starts at. Defaults to `/`. */
  route?: string;
  /** The route pattern `ui` is registered at (e.g. `/products/:id`). Defaults to `route`. */
  path?: string;
  queryClient?: QueryClient;
}

/** Renders `ui` at `path`, with the router positioned at `route` — for a single page under test. */
export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  const route = options.route ?? '/';
  const path = options.path ?? route;

  return render(
    withProviders(
      <Routes>
        <Route path={path} element={ui} />
        <Route path="*" element={<div data-testid="fallback-route">{route}</div>} />
      </Routes>,
      [route],
      options.queryClient,
    ),
  );
}
