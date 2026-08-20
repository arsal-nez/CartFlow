import { render, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { withProviders } from '../test/renderWithProviders';
import { RequireAuth } from './RequireAuth';

jest.mock('./AuthContext', () => ({
  useAuth: jest.fn(),
}));

const { useAuth } = jest.requireMock('./AuthContext') as { useAuth: jest.Mock };

function renderGuardedCart(route = '/cart') {
  return render(
    withProviders(
      <Routes>
        <Route
          path="/cart"
          element={
            <RequireAuth>
              <div>Protected cart contents</div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>,
      [route],
    ),
  );
}

describe('RequireAuth', () => {
  beforeEach(() => {
    useAuth.mockReset();
  });

  it('shows a loading state while the session is being checked', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isInitializing: true });
    renderGuardedCart();

    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected cart contents')).not.toBeInTheDocument();
  });

  it('redirects to /login when signed out', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isInitializing: false });
    renderGuardedCart();

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected cart contents')).not.toBeInTheDocument();
  });

  it('renders the protected content when signed in', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, isInitializing: false });
    renderGuardedCart();

    expect(screen.getByText('Protected cart contents')).toBeInTheDocument();
  });
});
