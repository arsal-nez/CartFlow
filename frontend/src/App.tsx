import { Route, Routes } from 'react-router-dom';

import { RequireAdmin } from './auth/RequireAdmin';
import { RequireAuth } from './auth/RequireAuth';
import { SiteHeader } from './components/layout/SiteHeader';
import { AdminDashboardPage } from './routes/admin/AdminDashboardPage';
import { AdminInventoryPage } from './routes/admin/AdminInventoryPage';
import { AdminProductEditPage } from './routes/admin/AdminProductEditPage';
import { AdminProductNewPage } from './routes/admin/AdminProductNewPage';
import { AdminProductsPage } from './routes/admin/AdminProductsPage';
import { CartPage } from './routes/CartPage';
import { HomePage } from './routes/HomePage';
import { LoginPage } from './routes/LoginPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { ProductDetailPage } from './routes/ProductDetailPage';
import { ProductsPage } from './routes/ProductsPage';
import { RegisterPage } from './routes/RegisterPage';

export function App() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route
            path="/cart"
            element={
              <RequireAuth>
                <CartPage />
              </RequireAuth>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminDashboardPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/products"
            element={
              <RequireAdmin>
                <AdminProductsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/products/new"
            element={
              <RequireAdmin>
                <AdminProductNewPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/products/:id/edit"
            element={
              <RequireAdmin>
                <AdminProductEditPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/inventory"
            element={
              <RequireAdmin>
                <AdminInventoryPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
