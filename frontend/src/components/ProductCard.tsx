import { Link } from 'react-router-dom';

import type { Product } from '../api/products';
import { Money } from './Money';
import { ProductImage } from './ProductImage';

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link to={`/products/${encodeURIComponent(product.productId)}`} className="card product-card">
      <ProductImage
        name={product.name}
        imageKeys={product.imageKeys}
        className="product-card__image"
      />
      <div className="product-card__body">
        <span className="product-card__name">{product.name}</span>
        <span className="product-card__price">
          <Money cents={product.priceCents} currency={product.currency} />
        </span>
      </div>
    </Link>
  );
}
