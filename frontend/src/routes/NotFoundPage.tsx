import { Link } from 'react-router-dom';

import { EmptyState } from '../components/feedback/EmptyState';

export function NotFoundPage() {
  return (
    <div className="page-container">
      <EmptyState
        icon="🧭"
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={
          <Link to="/" className="btn btn-primary">
            Back home
          </Link>
        }
      />
    </div>
  );
}
