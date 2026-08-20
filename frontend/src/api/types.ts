/**
 * Mirrors CartFlow API's shared response envelope
 * (`backend/src/responses/response.ts`, documented in
 * `docs/architecture.md#api-response-format`). Kept as a local, hand-written
 * contract rather than importing backend types: the frontend and backend
 * are independently deployable services (see `docs/architecture.md`) and
 * should not share a build-time dependency on each other's source.
 */

export interface ApiPageInfo {
  nextCursor: string | null;
  limit: number;
}

export interface ApiFieldIssue {
  path: string;
  message: string;
}

export interface ApiSuccessBody<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiPaginatedSuccessBody<T> {
  ok: true;
  data: T[];
  page: ApiPageInfo;
  requestId: string;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: ApiFieldIssue[];
  };
  requestId: string;
}
