import type { ApiGatewayEvent } from '../types/http';

/**
 * Reads the parsed path/query/body payload the `validate()` middleware
 * attached to `event.validated`. Generic `T` is supplied per-handler as the
 * exact shape that handler's schemas produce (e.g. `{ path: ProductIdPath }`).
 */
export function requireValidated<T>(event: ApiGatewayEvent): T {
  if (event.validated === undefined) {
    throw new Error('Request was not validated; ensure the validate() middleware ran first');
  }
  return event.validated as T;
}
