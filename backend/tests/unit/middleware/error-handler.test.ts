import { ZodError } from 'zod';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RequestValidationError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/errors/app-error';
import { errorHandler } from '../../../src/middleware/error-handler';
import { buildEvent, parseBody } from '../helpers/fake-event';

async function runOnError(error: unknown, event = buildEvent()) {
  const middleware = errorHandler();
  const request = { event, context: {}, error, response: undefined } as never as {
    event: ReturnType<typeof buildEvent>;
    error: unknown;
    response: { statusCode: number; body: string } | undefined;
  };
  await middleware.onError?.(request as never);
  return request.response as { statusCode: number; body: string };
}

describe('errorHandler', () => {
  it('maps RequestValidationError to 400 VALIDATION_ERROR with field details', async () => {
    const response = await runOnError(
      new RequestValidationError([{ path: 'body.name', message: 'name is required' }]),
    );
    expect(response.statusCode).toBe(400);
    const body = parseBody(response);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        details: [{ path: 'body.name', message: 'name is required' }],
      },
    });
  });

  it('maps a raw ZodError to 400 VALIDATION_ERROR', async () => {
    const zodError = new ZodError([{ code: 'custom', message: 'bad', path: ['name'] }]);
    const response = await runOnError(zodError);
    expect(response.statusCode).toBe(400);
    expect(parseBody(response).error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('maps UnauthorizedError to 401 and logs a structured authorization-failure entry', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await runOnError(
      new UnauthorizedError(),
      buildEvent({ path: '/api/v1/cart', requestId: 'req-401' }),
    );

    expect(response.statusCode).toBe(401);
    expect(parseBody(response).error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [warnLine] = warnSpy.mock.calls[0] as [string];
    const logged: unknown = JSON.parse(warnLine);
    expect(logged).toMatchObject({
      message: 'Authorization failure',
      code: 'UNAUTHORIZED',
      requestId: 'req-401',
      method: 'GET',
      path: '/api/v1/cart',
      callerUserId: null,
    });

    warnSpy.mockRestore();
  });

  it('maps ForbiddenError to 403 and logs the authenticated caller responsible', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await runOnError(
      new ForbiddenError(),
      buildEvent({ claims: { sub: 'user-42', 'cognito:groups': '["customer"]' } }),
    );

    expect(response.statusCode).toBe(403);
    expect(parseBody(response).error).toMatchObject({ code: 'FORBIDDEN' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [errorLine] = errorSpy.mock.calls[0] as [string];
    const logged: unknown = JSON.parse(errorLine);
    expect(logged).toMatchObject({
      message: 'Authorization failure',
      code: 'FORBIDDEN',
      callerUserId: 'user-42',
    });

    errorSpy.mockRestore();
  });

  it('never logs the error message/body for an authorization failure — metadata only', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await runOnError(new UnauthorizedError('a message that must never be echoed into the log'));

    const [loggedLine] = warnSpy.mock.calls[0] as [string];
    expect(loggedLine).not.toContain('must never be echoed');

    warnSpy.mockRestore();
  });

  it('maps NotFoundError to 404', async () => {
    const response = await runOnError(new NotFoundError('Product p-1 not found'));
    expect(response.statusCode).toBe(404);
    expect(parseBody(response).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps ConflictError to 409 for a duplicate product', async () => {
    const response = await runOnError(new ConflictError('Product p-1 already exists'));
    expect(response.statusCode).toBe(409);
    expect(parseBody(response).error).toMatchObject({ code: 'CONFLICT' });
  });

  it('maps a repository ValidationError to the API VALIDATION_ERROR code', async () => {
    const response = await runOnError(new ValidationError('limit must be a positive integer'));
    expect(response.statusCode).toBe(400);
    expect(parseBody(response).error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('maps an http-errors-style thrown object (e.g. malformed JSON body) to VALIDATION_ERROR', async () => {
    const httpError = Object.assign(new Error('Invalid JSON'), { statusCode: 422 });
    const response = await runOnError(httpError);
    expect(response.statusCode).toBe(422);
    expect(parseBody(response).error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('reduces an unrecognised error to a bare 500 INTERNAL_ERROR without leaking details', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await runOnError(new Error('some internal secret detail'));

    expect(response.statusCode).toBe(500);
    const body = parseBody(response);
    expect(body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(body)).not.toContain('some internal secret detail');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('includes the requestId from the API Gateway request context', async () => {
    const response = await runOnError(
      new NotFoundError('x'),
      buildEvent({ requestId: 'req-abc-123' }),
    );
    expect(parseBody(response).requestId).toBe('req-abc-123');
  });
});
