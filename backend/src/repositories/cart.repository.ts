import {
  QueryCommand,
  PutCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type {
  Cart,
  CartItem,
  CartItemInput,
  CreateCartInput,
  UpdateCartInput,
} from '../domain/cart';
import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import {
  getDocumentClient,
  getTableName,
  isConditionalCheckFailed,
  isTransactionConditionFailure,
} from '../lib/dynamodb';

/**
 * Cart key layout (see docs/database.md):
 *
 *   header: PK = USER#{userId}, SK = CART
 *   line:   PK = USER#{userId}, SK = CART#ITEM#{productId}
 *
 * Header and lines share a partition, so the whole cart is one Query.
 */
export const cartKeys = {
  pk: (userId: string): string => `USER#${userId}`,
  headerSk: (): string => 'CART',
  itemSk: (productId: string): string => `CART#ITEM#${productId}`,
  /** `CART` is a prefix of `CART#ITEM#...`, so this collects header + lines. */
  skPrefix: (): string => 'CART',
};

export const CART_ENTITY_TYPE = 'CART';
export const CART_ITEM_ENTITY_TYPE = 'CART_ITEM';

const DEFAULT_CURRENCY = 'USD';
/** DynamoDB allows 100 actions per transaction; one slot is the header update. */
const MAX_TRANSACT_ITEMS = 100;

export interface CartRepository {
  /** Returns the cart header with all its lines, or `null` when no cart exists. */
  getCart(userId: string): Promise<Cart | null>;
  createCart(input: CreateCartInput): Promise<Cart>;
  /** Replaces the cart contents wholesale: absent or zero-quantity lines are removed. */
  updateCart(input: UpdateCartInput): Promise<Cart>;
}

export interface CartRepositoryOptions {
  client?: DynamoDBDocumentClient;
  tableName?: string;
  now?: () => string;
}

interface CartHeaderItem {
  PK: string;
  SK: string;
  entityType: typeof CART_ENTITY_TYPE;
  userId: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

interface CartLineItem extends CartItem {
  PK: string;
  SK: string;
  entityType: typeof CART_ITEM_ENTITY_TYPE;
}

function isHeader(item: Record<string, unknown>): boolean {
  return item['SK'] === cartKeys.headerSk();
}

function toCartItem(item: unknown): CartItem {
  const raw = item as CartLineItem;
  return {
    userId: raw.userId,
    productId: raw.productId,
    quantity: raw.quantity,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function createCartRepository(options: CartRepositoryOptions = {}): CartRepository {
  const client = options.client ?? getDocumentClient();
  const tableName = options.tableName ?? getTableName();
  const now = options.now ?? ((): string => new Date().toISOString());

  return {
    async getCart(userId: string): Promise<Cart | null> {
      let header: CartHeaderItem | undefined;
      const items: CartItem[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;

      // A cart is small and bounded; page through it rather than truncating.
      do {
        const result = await client.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
            ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
            ExpressionAttributeValues: {
              ':pk': cartKeys.pk(userId),
              ':skPrefix': cartKeys.skPrefix(),
            },
            ScanIndexForward: true,
            ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
          }),
        );

        for (const item of result.Items ?? []) {
          if (isHeader(item)) {
            header = item as CartHeaderItem;
          } else {
            items.push(toCartItem(item));
          }
        }
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey !== undefined);

      if (header === undefined) {
        return null;
      }

      return {
        userId: header.userId,
        currency: header.currency,
        createdAt: header.createdAt,
        updatedAt: header.updatedAt,
        items,
      };
    },

    async createCart(input: CreateCartInput): Promise<Cart> {
      const timestamp = now();
      const header: CartHeaderItem = {
        PK: cartKeys.pk(input.userId),
        SK: cartKeys.headerSk(),
        entityType: CART_ENTITY_TYPE,
        userId: input.userId,
        currency: input.currency ?? DEFAULT_CURRENCY,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: header,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          throw new ConflictError(`Cart for user ${input.userId} already exists`);
        }
        throw error;
      }

      return {
        userId: header.userId,
        currency: header.currency,
        createdAt: header.createdAt,
        updatedAt: header.updatedAt,
        items: [],
      };
    },

    async updateCart(input: UpdateCartInput): Promise<Cart> {
      const current = await this.getCart(input.userId);
      if (current === null) {
        throw new NotFoundError(`Cart for user ${input.userId} not found`);
      }
      if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== current.updatedAt) {
        throw new ConflictError(`Cart for user ${input.userId} was modified concurrently`);
      }

      const desired = new Map<string, CartItemInput>();
      for (const line of input.items) {
        if (line.productId.includes('#')) {
          throw new ValidationError('productId must not contain "#"');
        }
        if (!Number.isInteger(line.quantity) || line.quantity < 0) {
          throw new ValidationError('quantity must be a non-negative integer');
        }
        if (desired.has(line.productId)) {
          throw new ValidationError(`Duplicate cart line for product ${line.productId}`);
        }
        desired.set(line.productId, line);
      }

      const existing = new Map(current.items.map((item) => [item.productId, item]));
      const timestamp = now();

      const nextItems: CartItem[] = [];
      const writes: NonNullable<
        ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
      > = [];

      // Header update doubles as the optimistic lock for the whole cart mutation.
      writes.push({
        Update: {
          TableName: tableName,
          Key: { PK: cartKeys.pk(input.userId), SK: cartKeys.headerSk() },
          UpdateExpression: 'SET #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND #updatedAt = :expectedUpdatedAt',
          ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
          ExpressionAttributeValues: {
            ':updatedAt': timestamp,
            ':expectedUpdatedAt': current.updatedAt,
          },
        },
      });

      for (const [productId, line] of desired) {
        const previous = existing.get(productId);
        if (line.quantity === 0) {
          if (previous !== undefined) {
            writes.push({
              Delete: {
                TableName: tableName,
                Key: { PK: cartKeys.pk(input.userId), SK: cartKeys.itemSk(productId) },
              },
            });
          }
          continue;
        }

        const item: CartLineItem = {
          PK: cartKeys.pk(input.userId),
          SK: cartKeys.itemSk(productId),
          entityType: CART_ITEM_ENTITY_TYPE,
          userId: input.userId,
          productId,
          quantity: line.quantity,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        writes.push({ Put: { TableName: tableName, Item: item } });
        nextItems.push(toCartItem(item));
      }

      // Lines the caller omitted are dropped: updateCart is a full replacement.
      for (const productId of existing.keys()) {
        if (!desired.has(productId)) {
          writes.push({
            Delete: {
              TableName: tableName,
              Key: { PK: cartKeys.pk(input.userId), SK: cartKeys.itemSk(productId) },
            },
          });
        }
      }

      if (writes.length > MAX_TRANSACT_ITEMS) {
        throw new ValidationError(
          `Cart update requires ${writes.length} writes, exceeding the DynamoDB transaction limit of ${MAX_TRANSACT_ITEMS}`,
        );
      }

      try {
        await client.send(new TransactWriteCommand({ TransactItems: writes }));
      } catch (error) {
        if (isTransactionConditionFailure(error)) {
          throw new ConflictError(`Cart for user ${input.userId} was modified concurrently`);
        }
        throw error;
      }

      nextItems.sort((a, b) => a.productId.localeCompare(b.productId));

      return {
        userId: current.userId,
        currency: current.currency,
        createdAt: current.createdAt,
        updatedAt: timestamp,
        items: nextItems,
      };
    },
  };
}
