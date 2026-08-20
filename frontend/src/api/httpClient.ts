import type {
  ApiErrorBody,
  ApiFieldIssue,
  ApiPageInfo,
  ApiPaginatedSuccessBody,
  ApiSuccessBody,
} from './types';

/**
 * The actual HTTP request/response logic, factored out of `client.ts` so it
 * can be unit-tested without touching `import.meta.env` — Vite resolves
 * `import.meta.env.*` at build time, but Jest's CommonJS runtime cannot
 * parse `import.meta` syntax at all (a real, verified limitation, not an
 * assumption — see `client.test.ts`). `client.ts` wires the app's real
 * config into `createApiClient`; tests wire in fakes instead.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ApiFieldIssue[] | undefined;

  constructor(message: string, code: string, status: number, details?: ApiFieldIssue[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type QueryValue = string | number | boolean | undefined;

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue> | undefined;
  signal?: AbortSignal | undefined;
}

export interface Page<T> {
  items: T[];
  page: ApiPageInfo;
}

export interface ApiClientDeps {
  /** Returns the API base URL, e.g. `https://api.example.com`. Throws if unconfigured. */
  getBaseUrl: () => string;
  /** Returns the current caller's id token, or `null` if signed out. */
  getAuthToken: () => string | null;
}

function isErrorBody(payload: unknown): payload is ApiErrorBody {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'ok' in payload &&
    (payload as { ok: unknown }).ok === false
  );
}

export function createApiClient(deps: ApiClientDeps) {
  function buildUrl(path: string, query: Record<string, QueryValue> | undefined): string {
    const base = deps.getBaseUrl();
    const url = new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async function request(path: string, options: ApiRequestOptions): Promise<unknown> {
    const url = buildUrl(path, options.query);
    const token = deps.getAuthToken();

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (token !== null) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause;
      }
      throw new ApiError(
        'Unable to reach the server. Check your connection and try again.',
        'NETWORK_ERROR',
        0,
      );
    }

    if (response.status === 204) {
      return null;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        'The server returned an unreadable response.',
        'INVALID_RESPONSE',
        response.status,
      );
    }

    if (!response.ok || isErrorBody(payload)) {
      const errorBody = isErrorBody(payload) ? payload : null;
      throw new ApiError(
        errorBody?.error.message ?? `Request failed with status ${response.status}.`,
        errorBody?.error.code ?? 'UNKNOWN_ERROR',
        response.status,
        errorBody?.error.details,
      );
    }

    return payload;
  }

  return {
    /** For a single-resource endpoint returning `{ ok, data, requestId }`. */
    async apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
      const payload = await request(path, options);
      return (payload as ApiSuccessBody<T>).data;
    },

    /** For a collection endpoint returning `{ ok, data: [...], page, requestId }`. */
    async apiFetchPage<T>(path: string, options: ApiRequestOptions = {}): Promise<Page<T>> {
      const payload = await request(path, options);
      const body = payload as ApiPaginatedSuccessBody<T>;
      return { items: body.data, page: body.page };
    },
  };
}
