import type { MiddlewareObj } from '@middy/core';
import type { ZodError, ZodTypeAny } from 'zod';

import { RequestValidationError, type FieldIssue } from '../errors/app-error';
import type { ApiGatewayEvent, ApiGatewayResult } from '../types/http';

export interface ValidateSchemas<
  TPath extends ZodTypeAny = ZodTypeAny,
  TQuery extends ZodTypeAny = ZodTypeAny,
  TBody extends ZodTypeAny = ZodTypeAny,
> {
  path?: TPath;
  query?: TQuery;
  body?: TBody;
}

function collectIssues(error: ZodError, section: string): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: [section, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

/**
 * Validates `event.pathParameters`, `event.queryStringParameters`, and the
 * (already JSON-parsed) `event.body` against the supplied Zod schemas, then
 * writes the parsed — and, per-schema, sanitized — result onto
 * `event.validated`. A schema failure never reaches a service: it throws
 * `RequestValidationError`, which the `errorHandler()` middleware turns into
 * a 400 `VALIDATION_ERROR` response with per-field details.
 */
export function validate<
  TPath extends ZodTypeAny,
  TQuery extends ZodTypeAny,
  TBody extends ZodTypeAny,
>(
  schemas: ValidateSchemas<TPath, TQuery, TBody>,
): MiddlewareObj<ApiGatewayEvent, ApiGatewayResult> {
  return {
    before: (request) => {
      const issues: FieldIssue[] = [];
      const validated: { path?: unknown; query?: unknown; body?: unknown } = {};

      if (schemas.path) {
        const result = schemas.path.safeParse(request.event.pathParameters ?? {});
        if (result.success) {
          validated.path = result.data;
        } else {
          issues.push(...collectIssues(result.error, 'path'));
        }
      }

      if (schemas.query) {
        const result = schemas.query.safeParse(request.event.queryStringParameters ?? {});
        if (result.success) {
          validated.query = result.data;
        } else {
          issues.push(...collectIssues(result.error, 'query'));
        }
      }

      if (schemas.body) {
        const result = schemas.body.safeParse(request.event.body ?? {});
        if (result.success) {
          validated.body = result.data;
        } else {
          issues.push(...collectIssues(result.error, 'body'));
        }
      }

      if (issues.length > 0) {
        throw new RequestValidationError(issues);
      }

      request.event.validated = validated;
    },
  };
}
