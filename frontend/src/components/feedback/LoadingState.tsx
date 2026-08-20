export interface LoadingStateProps {
  label?: string;
}

/** Generic loading indicator for a page or section awaiting a query. */
export function LoadingState({ label = 'Loading…' }: LoadingStateProps) {
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

/** Small inline spinner for buttons and compact areas. */
export function InlineSpinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner spinner-sm" role="status" aria-label={label} />;
}
