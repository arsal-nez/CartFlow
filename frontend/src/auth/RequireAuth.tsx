import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { LoadingState } from '../components/feedback/LoadingState';
import { useAuth } from './AuthContext';

/** Route guard for authenticated-only pages (e.g. /cart). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isInitializing } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return <LoadingState label="Checking your session…" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
