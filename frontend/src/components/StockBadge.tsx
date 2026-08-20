import type { ProductStock } from '../api/products';

export function StockBadge({ stock }: { stock: ProductStock }) {
  if (stock.stockStatus === 'OUT_OF_STOCK') {
    return <span className="badge badge-danger">Out of stock</span>;
  }
  if (stock.stockStatus === 'LOW') {
    return <span className="badge badge-warning">Only {stock.availableQuantity} left</span>;
  }
  return <span className="badge badge-success">In stock</span>;
}
