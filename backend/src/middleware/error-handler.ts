import type { MiddlewareObj } from '@middy/core';
import { ZodError } from 'zod';

import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RequestValidationError,
  UnauthorizedError,
  ValidationError,
  type FieldIssue,
} from '../errors/app-error';
import { getCurrentUser } from './auth';
import { errorResponse } from '../responses/response';
import type { ApiGatewayEvent, ApiGatewayResult } from '../types/http';
import { getRequestId } from '../utils/request-id';

function zodDetails(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * Structured, single-line JSON logs for authorization failures — the one
 * category of expected (non-500) error genuinely worth an audit trail.
 * Deliberately logs only request *metadata* (method, route, requestId,
 * caller id if known) and the error *code*, never `error.message` or any
 * request body: those are safe today (every `AppError` message here is a
 * static, developer-authored string), but logging by field keeps it that
 * way even if a future message ever interpolates request data. Previously
 * nothing logged 401/403s at all, so there was no way to notice a token-
 * scanning or privilege-escalation attempt after the fact — see
 * PRODUCTION_READINESS.md, "Logging".
 */
function logAuthorizationFailure(
  level: 'warn' | 'error',
  code: string,
  event: ApiGatewayEvent,
  requestId: string,
): void {
  const caller = getCurrentUser(event);
  console[level](
    JSON.stringify({
      message: 'Authorization failure',
      code,
      requestId,
      method: event.requestContext.http.method,
      path: event.requestContext.http.path,
      callerUserId: caller?.userId ?? null,
    }),
  );
}

/** Duck-types an `http-errors`-style 4xx thrown by a Middy body-parsing middleware. */
function isClientError(error: unknown): error is Error & { statusCode: number } {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return false;
  }
  const { statusCode } = error as { statusCode: unknown };
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

/**
 * The single place that turns a thrown error into the API's error response
 * contract (`docs/architecture.md#api-response-format`). Placed last in every
 * handler's middleware chain so it catches failures from earlier middleware
 * (`validate()`, `adminGuard()`) as well as the handler and service layer.
 * Unrecognized errors are logged server-side and reduced to a bare
 * `INTERNAL_ERROR` — no internal detail (stack trace, message) reaches the
 * client.
 */
export function errorHandler(): MiddlewareObj<ApiGatewayEvent, ApiGatewayResult> {
  return {
    onError: (request) => {
      const error: unknown = request.error;
      const requestId = getRequestId(request.event);

      if (error instanceof RequestValidationError) {
        request.response = errorResponse(
          'VALIDATION_ERROR',
          error.message,
          error.details,
          400,
          requestId,
        );
        return;
      }
      if (error instanceof ZodError) {
        request.response = errorResponse(
          'VALIDATION_ERROR',
          'Request validation failed',
          zodDetails(error),
          400,
          requestId,
        );
        return;
      }
      if (error instanceof UnauthorizedError) {
        logAuthorizationFailure('warn', 'UNAUTHORIZED', request.event, requestId);
        request.response = errorResponse('UNAUTHORIZED', error.message, undefined, 401, requestId);
        return;
      }
      if (error instanceof ForbiddenError) {
        // A *higher* level than 401: this is an authenticated caller whose
        // own identity is known, deliberately attempting an action their
        // role doesn't permit (e.g. a customer hitting an admin route) —
        // more actionable to a reviewer than an anonymous 401.
        logAuthorizationFailure('error', 'FORBIDDEN', request.event, requestId);
        request.response = errorResponse('FORBIDDEN', error.message, undefined, 403, requestId);
        return;
      }
      if (error instanceof NotFoundError) {
        request.response = errorResponse('NOT_FOUND', error.message, undefined, 404, requestId);
        return;
      }
      if (error instanceof ConflictError) {
        request.response = errorResponse('CONFLICT', error.message, undefined, 409, requestId);
        return;
      }
      if (error instanceof ValidationError) {
        // Repository-level input rejection (e.g. bad pagination limit): the
        // API surface still reports it as VALIDATION_ERROR per docs/api.md.
        request.response = errorResponse(
          'VALIDATION_ERROR',
          error.message,
          undefined,
          400,
          requestId,
        );
        return;
      }
      if (error instanceof AppError) {
        request.response = errorResponse(
          error.code,
          error.message,
          undefined,
          error.statusCode,
          requestId,
        );
        return;
      }
      if (isClientError(error)) {
        // e.g. @middy/http-json-body-parser rejecting malformed JSON: a
        // request-shape problem, not a server fault.
        request.response = errorResponse(
          'VALIDATION_ERROR',
          error.message,
          undefined,
          error.statusCode,
          requestId,
        );
        return;
      }

      // Structured server-side log; never sent to the client.
      console.error('Unhandled error', error);
      request.response = errorResponse(
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        undefined,
        500,
        requestId,
      );
    },
  };
}
