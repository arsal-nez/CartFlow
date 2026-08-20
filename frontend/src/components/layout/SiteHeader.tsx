import { useQuery } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';

import { getCart } from '../../api/cart';
import { queryKeys } from '../../api/queryKeys';
import { useAuth } from '../../auth/AuthContext';

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? 'is-active' : '';
}

export function SiteHeader() {
  const { isAuthenticated, user, signOut } = useAuth();
  const navigate = useNavigate();

  // Kept lightweight and resilient: an anonymous visitor has no cart to
  // fetch, and a failed count fetch should never break site navigation, so
  // errors are swallowed here (the Cart page itself surfaces them properly).
  const cartQuery = useQuery({
    queryKey: queryKeys.cart.root,
    queryFn: ({ signal }) => getCart(signal),
    enabled: isAuthenticated,
    retry: false,
  });
  const itemCount = cartQuery.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const handleSignOut = () => {
    signOut();
    navigate('/');
  };

  return (
    <header className="site-header">
      <div className="site-header__bar">
        <NavLink to="/" className="site-header__brand">
          CartFlow
        </NavLink>
        <nav className="site-header__nav" aria-label="Primary">
          <NavLink to="/products" className={navLinkClassName}>
            Products
          </NavLink>
        </nav>
        <div className="site-header__spacer" />
        <nav className="site-header__nav" aria-label="Account">
          <NavLink to="/cart" className={navLinkClassName}>
            <span className="cart-badge">
              Cart
              {itemCount > 0 && <span className="cart-badge__count">{itemCount}</span>}
            </span>
          </NavLink>
          {isAuthenticated ? (
            <>
              {user?.isAdmin === true && (
                <NavLink to="/admin" className={navLinkClassName}>
                  Admin
                </NavLink>
              )}
              {user?.email !== null && user?.email !== undefined && (
                <span className="field-hint">{user.email}</span>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={navLinkClassName}>
                Log in
              </NavLink>
              <NavLink to="/register" className="btn btn-primary btn-sm">
                Sign up
              </NavLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
