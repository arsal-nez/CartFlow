// Imports from `httpClient.ts`, not `client.ts`: `client.ts` touches
// `import.meta.env` at module scope, which Jest's CommonJS runtime cannot
// parse at all (a real, verified limitation — see `api/client.test.ts`).
// `ErrorState` is rendered by nearly every page, so pulling `ApiError` in
// from the wrong module here would make every page test crash on import.
import { ApiError } from '../../api/httpClient';

export interface ErrorStateProps {
  error: unknown;
  /** Shown above the error detail, e.g. "Couldn't load products". */
  title?: string;
  onRetry?: () => void;
}

/** Turns any caught error (ApiError, network failure, or unexpected throw) into a readable message. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something unexpected went wrong.';
}

/** Standard error panel used by every query-driven page/section. */
export function ErrorState({ error, title = 'Something went wrong', onRetry }: ErrorStateProps) {
  return (
    <div className="state-panel" role="alert">
      <div className="state-panel__icon" aria-hidden="true">
        ⚠️
      </div>
      <h3>{title}</h3>
      <p>{describeError(error)}</p>
      {onRetry !== undefined ? (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Compact inline variant for forms (e.g. login/register submit failures). */
export function InlineError({ error }: { error: unknown }) {
  return (
    <div className="alert alert-danger" role="alert">
      {describeError(error)}
    </div>
  );
}
