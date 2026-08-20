export interface PaginationControlsProps {
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  disabled?: boolean;
}

/** Cursor-based pagination (no page numbers): CartFlow's API pages by opaque cursor, not offset. */
export function PaginationControls({
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  disabled = false,
}: PaginationControlsProps) {
  if (!hasPrevious && !hasNext) {
    return null;
  }

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onPrevious}
        disabled={disabled || !hasPrevious}
      >
        ← Previous
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onNext}
        disabled={disabled || !hasNext}
      >
        Next →
      </button>
    </nav>
  );
}
