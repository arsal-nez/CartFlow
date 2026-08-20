import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  deriveStockStatus,
  type Inventory,
  type StockStatus,
  type UpdateInventoryInput,
} from '../domain/inventory';
import { ConflictError, ValidationError } from '../errors/app-error';
import {
  getDocumentClient,
  getTableName,
  isConditionalCheckFailed,
  padQuantity,
} from '../lib/dynamodb';

/**
 * Inventory key layout (see docs/database.md):
 *
 *   PK     = PRODUCT#{productId}
 *   SK     = INVENTORY
 *   GSI3PK = INVENTORY#STATUS#{stockStatus}
 *   GSI3SK = AVAILABLE#{availableQuantityPadded}#PRODUCT#{productId}
 *
 * Inventory shares a partition with the product metadata item, so checkout can
 * read both in one Query and write both in one transaction.
 */
export const inventoryKeys = {
  pk: (productId: string): string => `PRODUCT#${productId}`,
  sk: (): string => 'INVENTORY',
  gsi3pk: (stockStatus: StockStatus): string => `INVENTORY#STATUS#${stockStatus}`,
  gsi3sk: (availableQuantity: number, productId: string): string =>
    `AVAILABLE#${padQuantity(availableQuantity)}#PRODUCT#${productId}`,
};

export const INVENTORY_ENTITY_TYPE = 'INVENTORY';

interface InventoryItem extends Inventory {
  PK: string;
  SK: string;
  GSI3PK: string;
  GSI3SK: string;
  entityType: typeof INVENTORY_ENTITY_TYPE;
}

export interface GetInventoryOptions {
  /** Use a strongly consistent read; required before any stock decision. */
  consistentRead?: boolean;
}

export interface InventoryRepository {
  getInventory(productId: string, options?: GetInventoryOptions): Promise<Inventory | null>;
  /**
   * Conditional read-modify-write. Absolute values replace the counter, deltas
   * adjust it, and the write only lands if the stored counters still match what
   * was read. Creates the record when it does not exist and absolute values are
   * supplied.
   */
  updateInventory(productId: string, input: UpdateInventoryInput): Promise<Inventory>;
}

export interface InventoryRepositoryOptions {
  client?: DynamoDBDocumentClient;
  tableName?: string;
  now?: () => string;
}

/** Projects a stored item onto the domain shape, dropping key and index attributes. */
function toInventory(item: unknown): Inventory {
  const raw = item as InventoryItem;
  return {
    productId: raw.productId,
    availableQuantity: raw.availableQuantity,
    reservedQuantity: raw.reservedQuantity,
    reorderThreshold: raw.reorderThreshold,
    stockStatus: raw.stockStatus,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function resolveNext(
  current: number,
  absolute: number | undefined,
  delta: number | undefined,
  label: string,
): number {
  if (absolute !== undefined && delta !== undefined) {
    throw new ValidationError(`Provide either ${label} or ${label}Delta, not both`);
  }
  if (absolute !== undefined) {
    if (!Number.isInteger(absolute) || absolute < 0) {
      throw new ValidationError(`${label} must be a non-negative integer`);
    }
    return absolute;
  }
  if (delta !== undefined) {
    if (!Number.isInteger(delta)) {
      throw new ValidationError(`${label}Delta must be an integer`);
    }
    const next = current + delta;
    if (next < 0) {
      throw new ValidationError(`${label} cannot go below zero`);
    }
    return next;
  }
  return current;
}

export function createInventoryRepository(
  options: InventoryRepositoryOptions = {},
): InventoryRepository {
  const client = options.client ?? getDocumentClient();
  const tableName = options.tableName ?? getTableName();
  const now = options.now ?? ((): string => new Date().toISOString());

  return {
    async getInventory(
      productId: string,
      getOptions: GetInventoryOptions = {},
    ): Promise<Inventory | null> {
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: inventoryKeys.pk(productId), SK: inventoryKeys.sk() },
          ConsistentRead: getOptions.consistentRead ?? false,
        }),
      );
      return result.Item === undefined ? null : toInventory(result.Item);
    },

    async updateInventory(productId: string, input: UpdateInventoryInput): Promise<Inventory> {
      const current = await this.getInventory(productId, { consistentRead: true });
      const timestamp = now();

      if (current === null) {
        if (input.availableQuantity === undefined) {
          throw new ValidationError(
            `Inventory for product ${productId} does not exist; supply an absolute availableQuantity to initialise it`,
          );
        }
        if (
          input.availableQuantityDelta !== undefined ||
          input.reservedQuantityDelta !== undefined
        ) {
          throw new ValidationError(
            `Inventory for product ${productId} does not exist; deltas cannot be applied`,
          );
        }

        const availableQuantity = resolveNext(
          0,
          input.availableQuantity,
          undefined,
          'availableQuantity',
        );
        const reservedQuantity = resolveNext(
          0,
          input.reservedQuantity,
          undefined,
          'reservedQuantity',
        );
        const reorderThreshold = resolveNext(
          0,
          input.reorderThreshold,
          undefined,
          'reorderThreshold',
        );
        const stockStatus = deriveStockStatus(availableQuantity, reorderThreshold);

        const item: InventoryItem = {
          PK: inventoryKeys.pk(productId),
          SK: inventoryKeys.sk(),
          GSI3PK: inventoryKeys.gsi3pk(stockStatus),
          GSI3SK: inventoryKeys.gsi3sk(availableQuantity, productId),
          entityType: INVENTORY_ENTITY_TYPE,
          productId,
          availableQuantity,
          reservedQuantity,
          reorderThreshold,
          stockStatus,
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
            throw new ConflictError(`Inventory for product ${productId} was created concurrently`);
          }
          throw error;
        }

        return toInventory(item);
      }

      if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== current.updatedAt) {
        throw new ConflictError(`Inventory for product ${productId} was modified concurrently`);
      }

      const availableQuantity = resolveNext(
        current.availableQuantity,
        input.availableQuantity,
        input.availableQuantityDelta,
        'availableQuantity',
      );
      const reservedQuantity = resolveNext(
        current.reservedQuantity,
        input.reservedQuantity,
        input.reservedQuantityDelta,
        'reservedQuantity',
      );
      const reorderThreshold = resolveNext(
        current.reorderThreshold,
        input.reorderThreshold,
        undefined,
        'reorderThreshold',
      );
      const stockStatus = deriveStockStatus(availableQuantity, reorderThreshold);

      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: inventoryKeys.pk(productId), SK: inventoryKeys.sk() },
            UpdateExpression:
              'SET #availableQuantity = :availableQuantity, #reservedQuantity = :reservedQuantity, ' +
              '#reorderThreshold = :reorderThreshold, #stockStatus = :stockStatus, ' +
              '#updatedAt = :updatedAt, #gsi3pk = :gsi3pk, #gsi3sk = :gsi3sk',
            // The counters read above must still be in place, otherwise a concurrent
            // sale has already consumed the stock this write is based on.
            ConditionExpression:
              'attribute_exists(PK) AND #availableQuantity = :expectedAvailableQuantity ' +
              'AND #reservedQuantity = :expectedReservedQuantity',
            ExpressionAttributeNames: {
              '#availableQuantity': 'availableQuantity',
              '#reservedQuantity': 'reservedQuantity',
              '#reorderThreshold': 'reorderThreshold',
              '#stockStatus': 'stockStatus',
              '#updatedAt': 'updatedAt',
              '#gsi3pk': 'GSI3PK',
              '#gsi3sk': 'GSI3SK',
            },
            ExpressionAttributeValues: {
              ':availableQuantity': availableQuantity,
              ':reservedQuantity': reservedQuantity,
              ':reorderThreshold': reorderThreshold,
              ':stockStatus': stockStatus,
              ':updatedAt': timestamp,
              ':gsi3pk': inventoryKeys.gsi3pk(stockStatus),
              ':gsi3sk': inventoryKeys.gsi3sk(availableQuantity, productId),
              ':expectedAvailableQuantity': current.availableQuantity,
              ':expectedReservedQuantity': current.reservedQuantity,
            },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return toInventory(result.Attributes ?? {});
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          throw new ConflictError(`Inventory for product ${productId} was modified concurrently`);
        }
        throw error;
      }
    },
  };
}
