import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Standard "nothing here" panel — empty search results, empty cart, etc. */
export function EmptyState({ icon = '🗂️', title, description, action }: EmptyStateProps) {
  return (
    <div className="state-panel">
      <div className="state-panel__icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      {description !== undefined ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
