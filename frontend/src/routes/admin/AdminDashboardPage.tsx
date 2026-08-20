import { Link } from 'react-router-dom';

import { AdminNav } from '../../components/admin/AdminNav';

export function AdminDashboardPage() {
  return (
    <div className="page-container">
      <h1>Admin dashboard</h1>
      <AdminNav />

      <div className="admin-dashboard-grid">
        <Link to="/admin/products" className="card admin-dashboard-card">
          <h3>Products</h3>
          <p>Create, edit, and archive products in the catalog.</p>
        </Link>
        <Link to="/admin/products/new" className="card admin-dashboard-card">
          <h3>New product</h3>
          <p>Add a product, including images, to the catalog.</p>
        </Link>
        <Link to="/admin/inventory" className="card admin-dashboard-card">
          <h3>Inventory</h3>
          <p>Review stock levels and fix low or out-of-stock products.</p>
        </Link>
      </div>
    </div>
  );
}
