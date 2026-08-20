import { randomUUID } from 'node:crypto';

import type {
  CreateProductInput,
  ListProductsByCategoryParams,
  ListProductsParams,
  Product,
  ProductStatus,
  UpdateProductPatch,
} from '../domain/product';
import { NotFoundError } from '../errors/app-error';
import type { Page } from '../lib/dynamodb';
import {
  createProductRepository,
  type ProductRepository,
} from '../repositories/product.repository';

// Optional fields are typed `T | undefined` (rather than bare `T`) to match
// what Zod's `.optional()` inference produces: callers pass a validated
// schema object straight through, which under `exactOptionalPropertyTypes`
// means the property may be *present* and set to `undefined`, not merely
// absent. Internals still use the absent-key spread pattern before handing
// values to the repository layer, whose interfaces are stricter.

export interface ListProductsQuery {
  categoryId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  /** Admin-only in practice — see `adminListProductsQuerySchema`. Defaults to ACTIVE. */
  status?: ProductStatus | undefined;
}

export interface CreateProductCommand {
  name: string;
  description: string;
  categoryId: string;
  priceCents: number;
  currency: string;
  status?: ProductStatus | undefined;
  imageKeys?: string[] | undefined;
}

export interface UpdateProductCommand {
  name?: string | undefined;
  description?: string | undefined;
  categoryId?: string | undefined;
  priceCents?: number | undefined;
  currency?: string | undefined;
  status?: ProductStatus | undefined;
  imageKeys?: string[] | undefined;
}

export interface ProductService {
  listProducts(query: ListProductsQuery): Promise<Page<Product>>;
  getProduct(productId: string): Promise<Product>;
  /** `productId` is server-generated (UUID); it is never accepted from the client. */
  createProduct(command: CreateProductCommand): Promise<Product>;
  updateProduct(productId: string, command: UpdateProductCommand): Promise<Product>;
  /** Soft delete: flips the product to `ARCHIVED` rather than removing it. */
  deleteProduct(productId: string): Promise<Product>;
}

export interface ProductServiceOptions {
  repository?: ProductRepository;
  idGenerator?: () => string;
}

/**
 * Business rules for the Product API. Authorization (admin-only mutations)
 * is enforced upstream by the `adminGuard()` middleware — this layer assumes
 * the caller was already authorized and focuses on shaping the request into
 * a valid repository command and mapping "not found" into a service-level
 * `NotFoundError` for reads that the repository itself just returns `null` for.
 */
export function createProductService(options: ProductServiceOptions = {}): ProductService {
  const repository = options.repository ?? createProductRepository();
  const generateProductId = options.idGenerator ?? (() => randomUUID());

  return {
    async listProducts(query) {
      const paging = {
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.status === undefined ? {} : { status: query.status }),
      };

      if (query.categoryId !== undefined) {
        const params: ListProductsByCategoryParams = { categoryId: query.categoryId, ...paging };
        return repository.listByCategory(params);
      }

      const params: ListProductsParams = paging;
      return repository.list(params);
    },

    async getProduct(productId) {
      const product = await repository.getById(productId);
      if (product === null) {
        throw new NotFoundError(`Product ${productId} not found`);
      }
      return product;
    },

    async createProduct(command) {
      const input: CreateProductInput = {
        productId: generateProductId(),
        name: command.name,
        description: command.description,
        categoryId: command.categoryId,
        priceCents: command.priceCents,
        currency: command.currency,
        ...(command.status === undefined ? {} : { status: command.status }),
        ...(command.imageKeys === undefined ? {} : { imageKeys: command.imageKeys }),
      };
      return repository.create(input);
    },

    async updateProduct(productId, command) {
      const patch: UpdateProductPatch = {
        ...(command.name === undefined ? {} : { name: command.name }),
        ...(command.description === undefined ? {} : { description: command.description }),
        ...(command.categoryId === undefined ? {} : { categoryId: command.categoryId }),
        ...(command.priceCents === undefined ? {} : { priceCents: command.priceCents }),
        ...(command.currency === undefined ? {} : { currency: command.currency }),
        ...(command.status === undefined ? {} : { status: command.status }),
        ...(command.imageKeys === undefined ? {} : { imageKeys: command.imageKeys }),
      };
      return repository.update(productId, patch);
    },

    async deleteProduct(productId) {
      return repository.deactivate(productId);
    },
  };
}
