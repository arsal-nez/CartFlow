import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { LoadingState } from '../components/feedback/LoadingState';
import { EmptyState } from '../components/feedback/EmptyState';
import { useAuth } from './AuthContext';

/**
 * Route guard for the `/admin/*` dashboard. Layered on top of the
 * authentication check: signed-out visitors are redirected to `/login`
 * (same as `RequireAuth`), and signed-in-but-non-admin visitors get a
 * clear "not allowed" panel rather than a silent redirect, since that's a
 * meaningfully different situation from "not signed in".
 *
 * This is a UI convenience only — every admin API call is independently
 * authorized server-side via `requireAdmin()` (Cognito `admin` group
 * membership), so this guard cannot itself grant or withhold any real
 * privilege.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAuthenticated, isInitializing, user } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return <LoadingState label="Checking your session…" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.isAdmin !== true) {
    return (
      <div className="page-container">
        <EmptyState
          icon="🔒"
          title="Admins only"
          description="Your account doesn't have admin privileges for the CartFlow dashboard."
        />
      </div>
    );
  }

  return <>{children}</>;
}
