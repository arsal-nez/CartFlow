import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Shared DynamoDB plumbing for the CartFlow single-table design.
 *
 * Repositories never construct a client themselves: they receive a
 * `DynamoDBDocumentClient` so unit tests can inject a fake `send`.
 */

export const GSI1_INDEX_NAME = 'GSI1';
export const GSI2_INDEX_NAME = 'GSI2';
export const GSI3_INDEX_NAME = 'GSI3';

/** Every key attribute a cursor is allowed to carry. */
const CURSOR_KEY_ATTRIBUTES = new Set([
  'PK',
  'SK',
  GSI1_INDEX_NAME + 'PK',
  GSI1_INDEX_NAME + 'SK',
  GSI2_INDEX_NAME + 'PK',
  GSI2_INDEX_NAME + 'SK',
  GSI3_INDEX_NAME + 'PK',
  GSI3_INDEX_NAME + 'SK',
]);

export type DynamoKey = Record<string, string>;

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or `null` when the collection is exhausted. */
  cursor: string | null;
}

const marshallOptions = {
  /** Repositories build partial update payloads; undefined attributes are simply omitted. */
  removeUndefinedValues: true,
  convertClassInstanceToMap: false,
  convertEmptyValues: false,
};

const unmarshallOptions = {
  /** Keep numbers as JS numbers; CartFlow stores cents and quantities, never big integers. */
  wrapNumbers: false,
};

export function createDocumentClient(baseClient?: DynamoDBClient): DynamoDBDocumentClient {
  const client =
    baseClient ??
    new DynamoDBClient({
      ...(process.env.AWS_REGION === undefined ? {} : { region: process.env.AWS_REGION }),
    });

  return DynamoDBDocumentClient.from(client, { marshallOptions, unmarshallOptions });
}

let cachedDocumentClient: DynamoDBDocumentClient | undefined;

/** Lambda-container-scoped singleton so connections are reused across invocations. */
export function getDocumentClient(): DynamoDBDocumentClient {
  cachedDocumentClient ??= createDocumentClient();
  return cachedDocumentClient;
}

/** Test seam: drops the memoised client. */
export function resetDocumentClient(): void {
  cachedDocumentClient = undefined;
}

export function getTableName(): string {
  const tableName = process.env.CARTFLOW_TABLE_NAME;
  if (tableName === undefined || tableName.trim() === '') {
    throw new Error('CARTFLOW_TABLE_NAME is not set');
  }
  return tableName;
}

/**
 * Encodes a `LastEvaluatedKey` as a URL-safe base64 cursor.
 * Returns `null` when DynamoDB reported no further pages.
 */
export function encodeCursor(lastEvaluatedKey: Record<string, unknown> | undefined): string | null {
  if (lastEvaluatedKey === undefined) {
    return null;
  }
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url');
}

/**
 * Decodes a client-supplied cursor back into an `ExclusiveStartKey`.
 * The shape is validated so a tampered cursor cannot smuggle arbitrary
 * attributes into a query.
 */
export function decodeCursor(cursor: string | null | undefined): DynamoKey | undefined {
  if (cursor === undefined || cursor === null || cursor === '') {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid pagination cursor');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid pagination cursor');
  }

  const key: DynamoKey = {};
  for (const [attribute, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!CURSOR_KEY_ATTRIBUTES.has(attribute) || typeof value !== 'string') {
      throw new Error('Invalid pagination cursor');
    }
    key[attribute] = value;
  }

  if (Object.keys(key).length === 0) {
    throw new Error('Invalid pagination cursor');
  }

  return key;
}

function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name?: unknown };
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

export function isConditionalCheckFailed(error: unknown): boolean {
  return errorName(error) === 'ConditionalCheckFailedException';
}

export function isTransactionCanceled(error: unknown): boolean {
  return errorName(error) === 'TransactionCanceledException';
}

/**
 * True when a cancelled transaction failed because at least one
 * `ConditionExpression` was not satisfied (as opposed to throttling).
 */
export function isTransactionConditionFailure(error: unknown): boolean {
  if (!isTransactionCanceled(error)) {
    return false;
  }
  const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
  if (!Array.isArray(reasons)) {
    return false;
  }
  return reasons.some((reason) => reason?.Code === 'ConditionalCheckFailed');
}

/** Zero-pads a quantity so it sorts lexicographically in a GSI sort key. */
export function padQuantity(quantity: number): string {
  return Math.max(0, Math.trunc(quantity)).toString().padStart(12, '0');
}
