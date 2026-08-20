import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { getDocumentClient, getTableName, isConditionalCheckFailed } from '../lib/dynamodb';

/**
 * Idempotency-key storage for unsafe POST endpoints that create a resource
 * as a side effect (`cart-add-item`, `product-create`) — see
 * `middleware/idempotency.ts` and docs/database.md, "Idempotency". A record
 * is just the previously-computed HTTP response, cached long enough for a
 * client's retry of the *same* logical request to replay it instead of
 * repeating the mutation.
 *
 * Key layout: PK = `IDEMPOTENCY#{scopeKey}`, SK = `RECORD`, with a `ttl`
 * attribute (epoch seconds) so DynamoDB expires records automatically —
 * this item family needs no manual cleanup and no read-side pagination.
 */
export const idempotencyKeys = {
  pk: (scopeKey: string): string => `IDEMPOTENCY#${scopeKey}`,
  sk: (): string => 'RECORD',
};

export interface IdempotencyRecord {
  /** The complete previously-returned `ApiGatewayResult`, JSON-serialized verbatim. */
  responseJson: string;
}

export interface IdempotencyRepository {
  /**
   * `null` when no record exists yet, or an existing one has already
   * expired. DynamoDB's TTL deletion is best-effort and can lag by minutes
   * to hours, so an expiry check happens here too rather than trusting
   * "the item is gone by the time we'd care" — a genuinely stale record
   * must never be replayed as if it were fresh.
   */
  getRecord(scopeKey: string): Promise<IdempotencyRecord | null>;
  /**
   * Conditioned on the key not already existing: if two requests carrying
   * the same key race each other, only the first save wins and the second
   * is silently dropped (not an error) — the response either one computed
   * is equally valid to serve on the next replay.
   */
  saveRecord(scopeKey: string, record: IdempotencyRecord, ttlSeconds: number): Promise<void>;
}

export interface IdempotencyRepositoryOptions {
  client?: DynamoDBDocumentClient;
  tableName?: string;
  /** Returns the current time as epoch seconds. Overridable for deterministic tests. */
  nowSeconds?: () => number;
}

interface IdempotencyItem {
  PK: string;
  SK: string;
  entityType: 'IDEMPOTENCY_RECORD';
  responseJson: string;
  ttl: number;
}

export function createIdempotencyRepository(
  options: IdempotencyRepositoryOptions = {},
): IdempotencyRepository {
  const client = options.client ?? getDocumentClient();
  const tableName = options.tableName ?? getTableName();
  const nowSeconds = options.nowSeconds ?? ((): number => Math.floor(Date.now() / 1000));

  return {
    async getRecord(scopeKey) {
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: idempotencyKeys.pk(scopeKey), SK: idempotencyKeys.sk() },
        }),
      );
      if (result.Item === undefined) {
        return null;
      }
      const item = result.Item as IdempotencyItem;
      if (item.ttl <= nowSeconds()) {
        return null;
      }
      return { responseJson: item.responseJson };
    },

    async saveRecord(scopeKey, record, ttlSeconds) {
      const item: IdempotencyItem = {
        PK: idempotencyKeys.pk(scopeKey),
        SK: idempotencyKeys.sk(),
        entityType: 'IDEMPOTENCY_RECORD',
        responseJson: record.responseJson,
        ttl: nowSeconds() + ttlSeconds,
      };
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          return;
        }
        throw error;
      }
    },
  };
}
