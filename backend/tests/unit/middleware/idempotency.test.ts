import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { idempotency } from '../../../src/middleware/idempotency';
import { errorHandler } from '../../../src/middleware/error-handler';
import { NotFoundError } from '../../../src/errors/app-error';
import type { IdempotencyRepository } from '../../../src/repositories/idempotency.repository';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../../src/types/http';
import { buildEvent, fakeLambdaContext } from '../helpers/fake-event';

function createFakeRepository(): jest.Mocked<IdempotencyRepository> {
  return { getRecord: jest.fn(), saveRecord: jest.fn() };
}

function buildHandler(
  repository: IdempotencyRepository,
  baseHandler: jest.Mock<Promise<ApiGatewayResult>, [ApiGatewayEvent]>,
) {
  return middy(baseHandler)
    .use(idempotency({ namespace: 'test-namespace', repository }))
    .use(errorHandler());
}

/**
 * Mirrors the real handlers' actual middleware order (idempotency
 * registered *before* `httpCors()`) — see `handlers/cart/add-item.ts` and
 * `handlers/products/create.ts`.
 */
function buildHandlerWithCors(
  repository: IdempotencyRepository,
  baseHandler: jest.Mock<Promise<ApiGatewayResult>, [ApiGatewayEvent]>,
) {
  return middy(baseHandler)
    .use(idempotency({ namespace: 'test-namespace', repository }))
    .use(httpCors())
    .use(errorHandler());
}

const ADMIN_CLAIMS = { sub: 'user-1' };
const SUCCESS_RESULT: ApiGatewayResult = {
  statusCode: 201,
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true,"data":{"id":"p-1"}}',
};

describe('idempotency middleware', () => {
  it('runs the handler normally and never touches the repository when no key header is sent', async () => {
    const repository = createFakeRepository();
    const baseHandler = jest.fn().mockResolvedValue(SUCCESS_RESULT);
    const handler = buildHandler(repository, baseHandler);

    const result = await handler(
      buildEvent({ method: 'POST', claims: ADMIN_CLAIMS }),
      fakeLambdaContext,
    );

    expect(result).toEqual(SUCCESS_RESULT);
    expect(baseHandler).toHaveBeenCalledTimes(1);
    expect(repository.getRecord).not.toHaveBeenCalled();
    expect(repository.saveRecord).not.toHaveBeenCalled();
  });

  it('runs the handler on first sight of a key and caches the successful response', async () => {
    const repository = createFakeRepository();
    repository.getRecord.mockResolvedValueOnce(null);
    const baseHandler = jest.fn().mockResolvedValue(SUCCESS_RESULT);
    const handler = buildHandler(repository, baseHandler);

    const result = await handler(
      buildEvent({ method: 'POST', claims: ADMIN_CLAIMS, headers: { 'idempotency-key': 'key-1' } }),
      fakeLambdaContext,
    );

    expect(result).toEqual(SUCCESS_RESULT);
    expect(baseHandler).toHaveBeenCalledTimes(1);
    expect(repository.getRecord).toHaveBeenCalledWith('test-namespace#user-1#key-1');
    expect(repository.saveRecord).toHaveBeenCalledWith(
      'test-namespace#user-1#key-1',
      { responseJson: JSON.stringify(SUCCESS_RESULT) },
      expect.any(Number),
    );
  });

  it('replays the cached response and never re-invokes the handler on a repeat key', async () => {
    const repository = createFakeRepository();
    repository.getRecord.mockResolvedValueOnce({ responseJson: JSON.stringify(SUCCESS_RESULT) });
    const baseHandler = jest.fn().mockResolvedValue({ statusCode: 500, body: 'should never run' });
    const handler = buildHandler(repository, baseHandler);

    const result = await handler(
      buildEvent({ method: 'POST', claims: ADMIN_CLAIMS, headers: { 'idempotency-key': 'key-1' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(201);
    expect(result.body).toBe(SUCCESS_RESULT.body);
    expect(baseHandler).not.toHaveBeenCalled();
    expect(repository.saveRecord).not.toHaveBeenCalled();
  });

  it('scopes the same key value separately per authenticated caller', async () => {
    const repository = createFakeRepository();
    repository.getRecord.mockResolvedValue(null);
    const baseHandler = jest.fn().mockResolvedValue(SUCCESS_RESULT);
    const handler = buildHandler(repository, baseHandler);

    await handler(
      buildEvent({
        method: 'POST',
        claims: { sub: 'user-A' },
        headers: { 'idempotency-key': 'same-key' },
      }),
      fakeLambdaContext,
    );
    await handler(
      buildEvent({
        method: 'POST',
        claims: { sub: 'user-B' },
        headers: { 'idempotency-key': 'same-key' },
      }),
      fakeLambdaContext,
    );

    expect(repository.getRecord).toHaveBeenNthCalledWith(1, 'test-namespace#user-A#same-key');
    expect(repository.getRecord).toHaveBeenNthCalledWith(2, 'test-namespace#user-B#same-key');
  });

  it('never caches a non-2xx response', async () => {
    const repository = createFakeRepository();
    repository.getRecord.mockResolvedValueOnce(null);
    const baseHandler = jest.fn().mockResolvedValue({ statusCode: 404, body: '{"ok":false}' });
    const handler = buildHandler(repository, baseHandler);

    await handler(
      buildEvent({ method: 'POST', claims: ADMIN_CLAIMS, headers: { 'idempotency-key': 'key-1' } }),
      fakeLambdaContext,
    );

    expect(repository.saveRecord).not.toHaveBeenCalled();
  });

  it('never caches a response when the handler throws', async () => {
    const repository = createFakeRepository();
    repository.getRecord.mockResolvedValueOnce(null);
    const baseHandler = jest.fn().mockRejectedValue(new NotFoundError('nope'));
    const handler = buildHandler(repository, baseHandler);

    const result = await handler(
      buildEvent({ method: 'POST', claims: ADMIN_CLAIMS, headers: { 'idempotency-key': 'key-1' } }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(404);
    expect(repository.saveRecord).not.toHaveBeenCalled();
  });

  it('replays a response that still carries the CORS headers httpCors added the first time', async () => {
    // Regression test: Middy (v5) skips *every* `after` middleware — not
    // just later-registered ones — for a request a `before` hook
    // short-circuits by setting `response`. A cached replay is exactly
    // that, so unless the full original response (headers included) is
    // persisted and this middleware runs before `httpCors()`, a replayed
    // response would silently lose its `Access-Control-Allow-Origin`
    // header and break real cross-origin retries. See the "Registration
    // order matters" note in `middleware/idempotency.ts`.
    const repository = createFakeRepository();
    repository.getRecord.mockResolvedValueOnce(null);
    const baseHandler = jest.fn().mockResolvedValue({
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    });
    const handler = buildHandlerWithCors(repository, baseHandler);

    const first = await handler(
      buildEvent({ method: 'POST', claims: ADMIN_CLAIMS, headers: { 'idempotency-key': 'key-1' } }),
      fakeLambdaContext,
    );
    expect(first.headers?.['Access-Control-Allow-Origin']).toBeDefined();

    const [, savedRecord] = repository.saveRecord.mock.calls[0] as [
      string,
      { responseJson: string },
      number,
    ];
    repository.getRecord.mockResolvedValueOnce(savedRecord);

    const second = await handler(
      buildEvent({ method: 'POST', claims: ADMIN_CLAIMS, headers: { 'idempotency-key': 'key-1' } }),
      fakeLambdaContext,
    );

    expect(second).toEqual(first);
    expect(second.headers?.['Access-Control-Allow-Origin']).toBeDefined();
  });

  it('treats a header longer than the maximum as "no key" rather than erroring', async () => {
    const repository = createFakeRepository();
    const baseHandler = jest.fn().mockResolvedValue(SUCCESS_RESULT);
    const handler = buildHandler(repository, baseHandler);

    const result = await handler(
      buildEvent({
        method: 'POST',
        claims: ADMIN_CLAIMS,
        headers: { 'idempotency-key': 'x'.repeat(500) },
      }),
      fakeLambdaContext,
    );

    expect(result).toEqual(SUCCESS_RESULT);
    expect(repository.getRecord).not.toHaveBeenCalled();
  });
});
