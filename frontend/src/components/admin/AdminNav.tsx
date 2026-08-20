import { NavLink } from 'react-router-dom';

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? 'is-active' : '';
}

/** Secondary nav for the `/admin/*` dashboard section. */
export function AdminNav() {
  return (
    <nav className="admin-nav" aria-label="Admin dashboard">
      <NavLink to="/admin" end className={navLinkClassName}>
        Overview
      </NavLink>
      <NavLink to="/admin/products" className={navLinkClassName}>
        Products
      </NavLink>
      <NavLink to="/admin/inventory" className={navLinkClassName}>
        Inventory
      </NavLink>
    </nav>
  );
}
