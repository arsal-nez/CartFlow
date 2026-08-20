import { getSession } from '../auth/tokenStore';
import { createApiClient } from './httpClient';

export { ApiError } from './httpClient';
export type { ApiRequestOptions, Page, QueryValue } from './httpClient';

/**
 * The only place in the app that calls `fetch` against the CartFlow API.
 * Every product/cart page goes through this — nothing renders data that
 * wasn't just read from a real HTTP response. See `httpClient.ts` for the
 * actual request logic and why it lives in a separate, `import.meta`-free
 * module.
 */

function getBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  if (baseUrl === undefined || baseUrl.trim() === '') {
    throw new Error(
      'VITE_API_BASE_URL is not configured. Set it in your .env file — see .env.example.',
    );
  }
  return baseUrl;
}

function getAuthToken(): string | null {
  const session = getSession();
  return session === null ? null : session.idToken;
}

const client = createApiClient({ getBaseUrl, getAuthToken });

export const apiFetch = client.apiFetch;
export const apiFetchPage = client.apiFetchPage;
