import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  normalizeProductName,
  type CreateProductInput,
  type ListProductsByCategoryParams,
  type ListProductsParams,
  type Product,
  type ProductStatus,
  type UpdateProductPatch,
} from '../domain/product';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import {
  GSI1_INDEX_NAME,
  decodeCursor,
  encodeCursor,
  getDocumentClient,
  getTableName,
  isConditionalCheckFailed,
  type Page,
} from '../lib/dynamodb';

/**
 * Product key layout (see docs/database.md):
 *
 *   PK     = PRODUCT#{productId}
 *   SK     = META
 *   GSI1PK = PRODUCTS#STATUS#{status}
 *   GSI1SK = CATEGORY#{categoryId}#NAME#{normalizedName}#PRODUCT#{productId}
 */
export const productKeys = {
  pk: (productId: string): string => `PRODUCT#${productId}`,
  sk: (): string => 'META',
  gsi1pk: (status: ProductStatus): string => `PRODUCTS#STATUS#${status}`,
  gsi1sk: (categoryId: string, normalizedName: string, productId: string): string =>
    `CATEGORY#${categoryId}#NAME#${normalizedName}#PRODUCT#${productId}`,
  gsi1skCategoryPrefix: (categoryId: string): string => `CATEGORY#${categoryId}#`,
};

export const PRODUCT_ENTITY_TYPE = 'PRODUCT';

interface ProductItem extends Product {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: typeof PRODUCT_ENTITY_TYPE;
}

export interface ProductRepository {
  create(input: CreateProductInput): Promise<Product>;
  getById(productId: string): Promise<Product | null>;
  list(params?: ListProductsParams): Promise<Page<Product>>;
  listByCategory(params: ListProductsByCategoryParams): Promise<Page<Product>>;
  update(productId: string, patch: UpdateProductPatch): Promise<Product>;
  /** Soft delete: flips status to `ARCHIVED` so the item leaves the active GSI1 partition. */
  deactivate(productId: string, expectedUpdatedAt?: string): Promise<Product>;
  /** Hard delete of the product metadata item. Prefer `deactivate` for catalog items. */
  delete(productId: string): Promise<void>;
}

export interface ProductRepositoryOptions {
  client?: DynamoDBDocumentClient;
  tableName?: string;
  now?: () => string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function resolveLimit(limit: number | undefined): number {
  const fallback = Number.parseInt(process.env.DEFAULT_PAGE_LIMIT ?? '', 10);
  const ceiling = Number.parseInt(process.env.MAX_PAGE_LIMIT ?? '', 10);
  const max = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : MAX_LIMIT;
  if (limit === undefined) {
    return Math.min(Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_LIMIT, max);
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError('limit must be a positive integer');
  }
  return Math.min(limit, max);
}

/** Projects a stored item onto the domain shape, dropping key and index attributes. */
function toProduct(item: unknown): Product {
  const raw = item as ProductItem;
  return {
    productId: raw.productId,
    name: raw.name,
    normalizedName: raw.normalizedName,
    description: raw.description,
    categoryId: raw.categoryId,
    status: raw.status,
    priceCents: raw.priceCents,
    currency: raw.currency,
    imageKeys: raw.imageKeys,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function createProductRepository(options: ProductRepositoryOptions = {}): ProductRepository {
  const client = options.client ?? getDocumentClient();
  const tableName = options.tableName ?? getTableName();
  const now = options.now ?? ((): string => new Date().toISOString());

  async function queryGsi1(
    status: ProductStatus,
    categoryId: string | undefined,
    limit: number | undefined,
    cursor: string | null | undefined,
  ): Promise<Page<Product>> {
    const expressionValues: Record<string, string> = {
      ':gsi1pk': productKeys.gsi1pk(status),
    };
    let keyCondition = '#gsi1pk = :gsi1pk';

    if (categoryId !== undefined) {
      keyCondition += ' AND begins_with(#gsi1sk, :gsi1skPrefix)';
      expressionValues[':gsi1skPrefix'] = productKeys.gsi1skCategoryPrefix(categoryId);
    }

    const exclusiveStartKey = decodeCursor(cursor);
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: GSI1_INDEX_NAME,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames:
          categoryId === undefined
            ? { '#gsi1pk': 'GSI1PK' }
            : { '#gsi1pk': 'GSI1PK', '#gsi1sk': 'GSI1SK' },
        ExpressionAttributeValues: expressionValues,
        Limit: resolveLimit(limit),
        ScanIndexForward: true,
        ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    return {
      items: (result.Items ?? []).map(toProduct),
      cursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  return {
    async create(input: CreateProductInput): Promise<Product> {
      const timestamp = now();
      const status: ProductStatus = input.status ?? 'DRAFT';
      const normalizedName = normalizeProductName(input.name);

      if (normalizedName === '') {
        throw new ValidationError('name must contain at least one alphanumeric character');
      }
      if (input.categoryId.includes('#')) {
        throw new ValidationError('categoryId must not contain "#"');
      }
      if (input.productId.includes('#')) {
        throw new ValidationError('productId must not contain "#"');
      }

      const item: ProductItem = {
        PK: productKeys.pk(input.productId),
        SK: productKeys.sk(),
        GSI1PK: productKeys.gsi1pk(status),
        GSI1SK: productKeys.gsi1sk(input.categoryId, normalizedName, input.productId),
        entityType: PRODUCT_ENTITY_TYPE,
        productId: input.productId,
        name: input.name,
        normalizedName,
        description: input.description,
        categoryId: input.categoryId,
        status,
        priceCents: input.priceCents,
        currency: input.currency,
        imageKeys: input.imageKeys ?? [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          throw new ConflictError(`Product ${input.productId} already exists`);
        }
        throw error;
      }

      return toProduct(item);
    },

    async getById(productId: string): Promise<Product | null> {
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: productKeys.pk(productId), SK: productKeys.sk() },
        }),
      );
      return result.Item === undefined ? null : toProduct(result.Item);
    },

    async list(params: ListProductsParams = {}): Promise<Page<Product>> {
      return queryGsi1(params.status ?? 'ACTIVE', undefined, params.limit, params.cursor);
    },

    async listByCategory(params: ListProductsByCategoryParams): Promise<Page<Product>> {
      return queryGsi1(params.status ?? 'ACTIVE', params.categoryId, params.limit, params.cursor);
    },

    async update(productId: string, patch: UpdateProductPatch): Promise<Product> {
      const current = await this.getById(productId);
      if (current === null) {
        throw new NotFoundError(`Product ${productId} not found`);
      }
      if (patch.expectedUpdatedAt !== undefined && patch.expectedUpdatedAt !== current.updatedAt) {
        throw new ConflictError(`Product ${productId} was modified concurrently`);
      }
      if (patch.categoryId !== undefined && patch.categoryId.includes('#')) {
        throw new ValidationError('categoryId must not contain "#"');
      }

      const timestamp = now();
      const next: Product = {
        ...current,
        ...(patch.name === undefined
          ? {}
          : { name: patch.name, normalizedName: normalizeProductName(patch.name) }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
        ...(patch.priceCents === undefined ? {} : { priceCents: patch.priceCents }),
        ...(patch.currency === undefined ? {} : { currency: patch.currency }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.imageKeys === undefined ? {} : { imageKeys: patch.imageKeys }),
        updatedAt: timestamp,
      };

      if (next.normalizedName === '') {
        throw new ValidationError('name must contain at least one alphanumeric character');
      }

      // Derived index keys are always rewritten: status, categoryId and name all feed them.
      const names: Record<string, string> = {
        '#name': 'name',
        '#normalizedName': 'normalizedName',
        '#description': 'description',
        '#categoryId': 'categoryId',
        '#status': 'status',
        '#priceCents': 'priceCents',
        '#currency': 'currency',
        '#imageKeys': 'imageKeys',
        '#updatedAt': 'updatedAt',
        '#gsi1pk': 'GSI1PK',
        '#gsi1sk': 'GSI1SK',
      };
      const values: Record<string, unknown> = {
        ':name': next.name,
        ':normalizedName': next.normalizedName,
        ':description': next.description,
        ':categoryId': next.categoryId,
        ':status': next.status,
        ':priceCents': next.priceCents,
        ':currency': next.currency,
        ':imageKeys': next.imageKeys,
        ':updatedAt': next.updatedAt,
        ':gsi1pk': productKeys.gsi1pk(next.status),
        ':gsi1sk': productKeys.gsi1sk(next.categoryId, next.normalizedName, next.productId),
        ':expectedUpdatedAt': current.updatedAt,
      };

      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: productKeys.pk(productId), SK: productKeys.sk() },
            UpdateExpression:
              'SET #name = :name, #normalizedName = :normalizedName, #description = :description, ' +
              '#categoryId = :categoryId, #status = :status, #priceCents = :priceCents, ' +
              '#currency = :currency, #imageKeys = :imageKeys, #updatedAt = :updatedAt, ' +
              '#gsi1pk = :gsi1pk, #gsi1sk = :gsi1sk',
            ConditionExpression: 'attribute_exists(PK) AND #updatedAt = :expectedUpdatedAt',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_NEW',
          }),
        );
        return toProduct(result.Attributes ?? {});
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          throw new ConflictError(`Product ${productId} was modified concurrently`);
        }
        throw error;
      }
    },

    async deactivate(productId: string, expectedUpdatedAt?: string): Promise<Product> {
      return this.update(productId, {
        status: 'ARCHIVED',
        ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
      });
    },

    async delete(productId: string): Promise<void> {
      try {
        await client.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { PK: productKeys.pk(productId), SK: productKeys.sk() },
            ConditionExpression: 'attribute_exists(PK)',
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          throw new NotFoundError(`Product ${productId} not found`);
        }
        throw error;
      }
    },
  };
}
