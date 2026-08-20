import type { ProductService } from '../../../src/services/product.service';

export interface FakeProductService {
  service: ProductService;
  listProducts: jest.Mock;
  getProduct: jest.Mock;
  createProduct: jest.Mock;
  updateProduct: jest.Mock;
  deleteProduct: jest.Mock;
}

/** A `ProductService` stand-in for handler tests — no repository, no AWS SDK involved. */
export function createFakeProductService(): FakeProductService {
  const listProducts = jest.fn();
  const getProduct = jest.fn();
  const createProduct = jest.fn();
  const updateProduct = jest.fn();
  const deleteProduct = jest.fn();

  return {
    service: { listProducts, getProduct, createProduct, updateProduct, deleteProduct },
    listProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
  };
}
