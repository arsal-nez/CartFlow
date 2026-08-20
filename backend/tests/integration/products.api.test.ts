/**
 * Full-stack integration tests: real API Gateway event -> real Middy
 * handler chain (CORS, auth/admin middleware, Zod `validate()`,
 * `errorHandler()`) -> real `ProductService` -> real `ProductRepository` ->
 * a fake `DynamoDBDocumentClient` that only ever answers canned, in-memory
 * responses. No AWS resource is touched, and every response comes from the
 * same command-building code that runs in production — unlike the
 * handler-level unit tests (which inject a fully mocked `ProductService`),
 * this exercises the real wiring between every layer for one request.
 */
import { buildCreateProductHandler } from '../../src/handlers/products/create';
import { buildGetProductHandler } from '../../src/handlers/products/get';
import { buildUpdateProductHandler } from '../../src/handlers/products/update';
import { buildDeleteProductHandler } from '../../src/handlers/products/remove';
import { buildListProductsHandler } from '../../src/handlers/products/list';
import { resetEnvConfig } from '../../src/config/env';
import type { IdempotencyRepository } from '../../src/repositories/idempotency.repository';
import { createProductRepository } from '../../src/repositories/product.repository';
import { createProductService } from '../../src/services/product.service';
import {
  FIXED_NOW,
  commandAt,
  conditionalCheckFailed,
  createFakeDocumentClient,
  fixedClock,
} from '../unit/helpers/fake-document-client';
import { buildEvent, fakeLambdaContext, parseBody } from '../unit/helpers/fake-event';

const TABLE = 'cartflow-test';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_CLAIMS = { sub: 'admin-1', 'cognito:groups': '["admin"]' };
const CUSTOMER_CLAIMS = { sub: 'user-1', 'cognito:groups': '["customer"]' };

const VALID_CREATE_BODY = {
  name: 'Trail Bottle',
  description: 'Insulated bottle',
  categoryId: 'drinkware',
  priceCents: 2499,
  currency: 'USD',
  status: 'ACTIVE',
};

const originalEnv = { ...process.env };

function setup() {
  const { client, send } = createFakeDocumentClient();
  const repository = createProductRepository({ client, tableName: TABLE, now: fixedClock });
  const service = createProductService({ repository, idGenerator: () => PRODUCT_ID });
  const idempotencyRepository: jest.Mocked<IdempotencyRepository> = {
    getRecord: jest.fn().mockResolvedValue(null),
    saveRecord: jest.fn().mockResolvedValue(undefined),
  };
  return {
    send,
    idempotencyRepository,
    handlers: {
      create: buildCreateProductHandler(service, idempotencyRepository),
      get: buildGetProductHandler(service),
      update: buildUpdateProductHandler(service),
      remove: buildDeleteProductHandler(service),
      list: buildListProductsHandler(service),
    },
  };
}

function storedItem(overrides: Record<string, unknown> = {}) {
  return {
    PK: `PRODUCT#${PRODUCT_ID}`,
    SK: 'META',
    GSI1PK: 'PRODUCTS#STATUS#ACTIVE',
    GSI1SK: `CATEGORY#drinkware#NAME#trail-bottle#PRODUCT#${PRODUCT_ID}`,
    entityType: 'PRODUCT',
    productId: PRODUCT_ID,
    name: 'Trail Bottle',
    normalizedName: 'trail-bottle',
    description: 'Insulated bottle',
    categoryId: 'drinkware',
    status: 'ACTIVE',
    priceCents: 2499,
    currency: 'USD',
    imageKeys: [],
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

beforeEach(() => {
  process.env = { ...originalEnv, CARTFLOW_TABLE_NAME: TABLE, ADMIN_GROUP_NAME: 'admin' };
  resetEnvConfig();
});

afterAll(() => {
  process.env = originalEnv;
  resetEnvConfig();
});

describe('POST /api/v1/products (full stack)', () => {
  it('201s and persists via a real PutCommand for an admin caller', async () => {
    const { send, handlers } = setup();
    send.mockResolvedValueOnce({});

    const result = await handlers.create(
      buildEvent({ method: 'POST', body: VALID_CREATE_BODY, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(201);
    expect(parseBody(result).data).toMatchObject({ productId: PRODUCT_ID, name: 'Trail Bottle' });
    expect(commandAt(send, 0).input).toMatchObject({
      TableName: TABLE,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    });
  });

  it('401s an unauthenticated caller before touching DynamoDB', async () => {
    const { send, handlers } = setup();

    const result = await handlers.create(
      buildEvent({ method: 'POST', body: VALID_CREATE_BODY }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(parseBody(result).error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('403s an authenticated non-admin caller before touching DynamoDB', async () => {
    const { send, handlers } = setup();

    const result = await handlers.create(
      buildEvent({ method: 'POST', body: VALID_CREATE_BODY, claims: CUSTOMER_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(parseBody(result).error).toMatchObject({ code: 'FORBIDDEN' });
    expect(send).not.toHaveBeenCalled();
  });

  it('400s an invalid price before touching DynamoDB', async () => {
    const { send, handlers } = setup();

    const result = await handlers.create(
      buildEvent({
        method: 'POST',
        body: { ...VALID_CREATE_BODY, priceCents: -500 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(send).not.toHaveBeenCalled();
  });

  it('409s a duplicate product id (conditional PutCommand failure)', async () => {
    const { send, handlers } = setup();
    send.mockRejectedValueOnce(conditionalCheckFailed());

    const result = await handlers.create(
      buildEvent({ method: 'POST', body: VALID_CREATE_BODY, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).error).toMatchObject({ code: 'CONFLICT' });
  });

  it('500s and hides the underlying cause when DynamoDB is unreachable', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { send, handlers } = setup();
    send.mockRejectedValueOnce(new Error('connect ETIMEDOUT 10.0.0.1:443'));

    const result = await handlers.create(
      buildEvent({ method: 'POST', body: VALID_CREATE_BODY, claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    const body = parseBody(result);
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('ETIMEDOUT');
    consoleSpy.mockRestore();
  });
});

describe('POST /api/v1/products — Idempotency-Key (full stack)', () => {
  it('replays the cached response and never issues a second PutCommand on a retried create', async () => {
    const { send, idempotencyRepository, handlers } = setup();
    send.mockResolvedValueOnce({});

    // A fresh event per call — see the identical note in cart.api.test.ts:
    // `@middy/http-json-body-parser` mutates `event.body` in place, so a
    // real client retry is a new event, not a reused reference.
    const buildRequest = () =>
      buildEvent({
        method: 'POST',
        body: VALID_CREATE_BODY,
        claims: ADMIN_CLAIMS,
        headers: { 'idempotency-key': 'admin-retry-1' },
      });

    const first = await handlers.create(buildRequest(), fakeLambdaContext);
    expect(first.statusCode).toBe(201);
    expect(send).toHaveBeenCalledTimes(1);
    expect(idempotencyRepository.saveRecord).toHaveBeenCalledTimes(1);

    const [, savedRecord] = idempotencyRepository.saveRecord.mock.calls[0] as [
      string,
      { responseJson: string },
      number,
    ];
    idempotencyRepository.getRecord.mockResolvedValueOnce(savedRecord);

    const second = await handlers.create(buildRequest(), fakeLambdaContext);

    expect(second).toEqual(first);
    // Still just the one PutCommand from the first call — no duplicate
    // product, and no second conditional-write attempt at all.
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/v1/products/{id} (full stack)', () => {
  it('200s with the stored product for a valid id', async () => {
    const { send, handlers } = setup();
    send.mockResolvedValueOnce({ Item: storedItem() });

    const result = await handlers.get(
      buildEvent({ pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result).data).toMatchObject({ productId: PRODUCT_ID, name: 'Trail Bottle' });
  });

  it('400s an invalid (non-UUID) id before touching DynamoDB', async () => {
    const { send, handlers } = setup();

    const result = await handlers.get(
      buildEvent({ pathParameters: { id: 'not-a-uuid' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(send).not.toHaveBeenCalled();
  });

  it('404s when DynamoDB has no matching item — public route, no auth required either way', async () => {
    const { send, handlers } = setup();
    send.mockResolvedValueOnce({});

    const result = await handlers.get(
      buildEvent({ pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('GET /api/v1/products (list, full stack)', () => {
  it('200s a paginated page of ACTIVE products', async () => {
    const { send, handlers } = setup();
    send.mockResolvedValueOnce({ Items: [storedItem()], LastEvaluatedKey: undefined });

    const result = await handlers.list(buildEvent(), fakeLambdaContext);

    expect(result.statusCode).toBe(200);
    const body = parseBody(result);
    expect(body.data).toHaveLength(1);
    expect(body.page).toMatchObject({ nextCursor: null });
    expect(commandAt(send, 0).input).toMatchObject({
      TableName: TABLE,
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':gsi1pk': 'PRODUCTS#STATUS#ACTIVE' },
    });
  });
});

describe('PUT /api/v1/products/{id} (full stack)', () => {
  it('200s and applies a partial patch for an admin caller', async () => {
    const { send, handlers } = setup();
    send.mockResolvedValueOnce({ Item: storedItem() }); // read-before-write inside update()
    send.mockResolvedValueOnce({ Attributes: storedItem({ priceCents: 1999 }) });

    const result = await handlers.update(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { priceCents: 1999 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result).data).toMatchObject({ priceCents: 1999 });
  });

  it('403s a non-admin caller before any DynamoDB read', async () => {
    const { send, handlers } = setup();

    const result = await handlers.update(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { priceCents: 1999 },
        claims: CUSTOMER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('409s when the item was modified concurrently (conditional UpdateCommand failure)', async () => {
    const { send, handlers } = setup();
    send.mockResolvedValueOnce({ Item: storedItem() });
    send.mockRejectedValueOnce(conditionalCheckFailed());

    const result = await handlers.update(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { priceCents: 1999 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).error).toMatchObject({ code: 'CONFLICT' });
  });

  it('404s an update for a product that does not exist', async () => {
    const { send, handlers } = setup();
    send.mockResolvedValueOnce({});

    const result = await handlers.update(
      buildEvent({
        method: 'PUT',
        pathParameters: { id: PRODUCT_ID },
        body: { priceCents: 1999 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/products/{id} (full stack — soft delete)', () => {
  it('200s and archives the product for an admin caller', async () => {
    const { send, handlers } = setup();
    send.mockResolvedValueOnce({ Item: storedItem() });
    send.mockResolvedValueOnce({ Attributes: storedItem({ status: 'ARCHIVED' }) });

    const result = await handlers.remove(
      buildEvent({
        method: 'DELETE',
        pathParameters: { id: PRODUCT_ID },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result).data).toMatchObject({ status: 'ARCHIVED' });
  });

  it('401s an unauthenticated delete attempt — an unauthorized admin operation', async () => {
    const { send, handlers } = setup();

    const result = await handlers.remove(
      buildEvent({ method: 'DELETE', pathParameters: { id: PRODUCT_ID } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('malformed request body (real @middy/http-json-body-parser behavior)', () => {
  it('returns 415, not 422, for unparseable JSON — this API never emits 422', async () => {
    // Some REST APIs use 422 Unprocessable Entity for semantic validation
    // failures. CartFlow deliberately doesn't: every validation failure
    // (path/query/body, via `validate()`/Zod) is reported as 400
    // VALIDATION_ERROR — see `errorHandler`'s `RequestValidationError`
    // branch and `docs/api.md`. The one other place a body-shaped failure
    // can originate is `@middy/http-json-body-parser` itself, when JSON.parse
    // throws on truly malformed input; that library reports it as 415
    // (verified against the installed package, not assumed — its own
    // source comment claims "UnprocessableEntity" but the actual call is
    // `createError(415, ...)`). This test pins that real, observed
    // behavior so a library upgrade that changes it doesn't go unnoticed.
    const { send, handlers } = setup();

    const result = await handlers.create(
      buildEvent({
        method: 'POST',
        rawBody: '{not valid json',
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(415);
    expect(result.statusCode).not.toBe(422);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(send).not.toHaveBeenCalled();
  });
});
