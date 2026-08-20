import { render, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { withProviders } from '../test/renderWithProviders';
import { RequireAdmin } from './RequireAdmin';

jest.mock('./AuthContext', () => ({
  useAuth: jest.fn(),
}));

const { useAuth } = jest.requireMock('./AuthContext') as { useAuth: jest.Mock };

function renderGuardedAdmin(route = '/admin/products') {
  return render(
    withProviders(
      <Routes>
        <Route
          path="/admin/products"
          element={
            <RequireAdmin>
              <div>Admin products console</div>
            </RequireAdmin>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>,
      [route],
    ),
  );
}

describe('RequireAdmin', () => {
  beforeEach(() => {
    useAuth.mockReset();
  });

  it('shows a loading state while the session is being checked', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isInitializing: true, user: null });
    renderGuardedAdmin();

    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
  });

  it('redirects to /login when signed out', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isInitializing: false, user: null });
    renderGuardedAdmin();

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Admin products console')).not.toBeInTheDocument();
  });

  it('shows an "admins only" panel for a signed-in non-admin — this is an unauthorized admin operation attempt', () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      isInitializing: false,
      user: { userId: 'u-1', email: 'shopper@example.com', isAdmin: false },
    });
    renderGuardedAdmin();

    expect(screen.getByText(/admins only/i)).toBeInTheDocument();
    expect(screen.queryByText('Admin products console')).not.toBeInTheDocument();
    // Crucially, it does NOT silently redirect to /login — a signed-in
    // non-admin is a materially different situation from signed-out.
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('renders the protected content for an admin', () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      isInitializing: false,
      user: { userId: 'u-1', email: 'admin@example.com', isAdmin: true },
    });
    renderGuardedAdmin();

    expect(screen.getByText('Admin products console')).toBeInTheDocument();
  });
});
