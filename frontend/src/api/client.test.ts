/**
 * @jest-environment node
 *
 * jsdom (this project's default test environment) does not implement
 * `fetch`/`Response`/`URL`; Node's runtime does natively. This file needs
 * none of the DOM, only the fetch API, so it opts into the `node`
 * environment rather than polyfilling fetch into jsdom project-wide.
 */

import { ApiError, createApiClient } from './httpClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createTestClient(authToken: string | null = null) {
  return createApiClient({
    getBaseUrl: () => 'https://api.cartflow.test/',
    getAuthToken: () => authToken,
  });
}

describe('apiFetch', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns the data field of a successful envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, data: { productId: 'p-1' }, requestId: 'req-1' }),
    );
    const { apiFetch } = createTestClient();

    const result = await apiFetch<{ productId: string }>('/api/v1/products/p-1');

    expect(result).toEqual({ productId: 'p-1' });
  });

  it('attaches the Authorization header from the injected token getter', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: {}, requestId: 'req-1' }));
    const { apiFetch } = createTestClient('id-token-abc');

    await apiFetch('/api/v1/cart');

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer id-token-abc');
  });

  it('omits the Authorization header when there is no token', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true, data: {}, requestId: 'req-1' }));
    const { apiFetch } = createTestClient(null);

    await apiFetch('/api/v1/products');

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('throws a typed ApiError carrying the server error code and message', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(404, {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Product not found' },
        requestId: 'req-1',
      }),
    );
    const { apiFetch } = createTestClient();

    await expect(apiFetch('/api/v1/products/missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Product not found',
      status: 404,
    });
  });

  it('throws a NETWORK_ERROR ApiError when fetch itself rejects', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    const { apiFetch } = createTestClient();

    await expect(apiFetch('/api/v1/products')).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch('/api/v1/products')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('sends validated JSON bodies with a Content-Type header', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(201, { ok: true, data: {}, requestId: 'req-1' }));
    const { apiFetch } = createTestClient();

    await apiFetch('/api/v1/cart/items', {
      method: 'POST',
      body: { productId: 'p-1', quantity: 2 },
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ productId: 'p-1', quantity: 2 }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

describe('apiFetchPage', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns items and page info from a paginated envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        data: [{ productId: 'p-1' }],
        page: { nextCursor: 'cursor-2', limit: 20 },
        requestId: 'req-1',
      }),
    );
    const { apiFetchPage } = createTestClient();

    const result = await apiFetchPage<{ productId: string }>('/api/v1/products');

    expect(result.items).toEqual([{ productId: 'p-1' }]);
    expect(result.page).toEqual({ nextCursor: 'cursor-2', limit: 20 });
  });

  it('encodes query parameters, dropping undefined values', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        data: [],
        page: { nextCursor: null, limit: 20 },
        requestId: 'req-1',
      }),
    );
    const { apiFetchPage } = createTestClient();

    await apiFetchPage('/api/v1/products', {
      query: { categoryId: 'drinkware', cursor: undefined, limit: 5 },
    });

    const [url] = fetchSpy.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('categoryId')).toBe('drinkware');
    expect(parsed.searchParams.has('cursor')).toBe(false);
    expect(parsed.searchParams.get('limit')).toBe('5');
  });
});
