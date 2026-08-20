import type { ApiGatewayResult } from '../types/http';

/** The shared response contract (docs/database.md's sibling, docs/api.md and docs/architecture.md). */

export interface PageInfo {
  nextCursor: string | null;
  limit: number;
}

function jsonResult(statusCode: number, body: unknown): ApiGatewayResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function successResponse<T>(data: T, requestId: string, statusCode = 200): ApiGatewayResult {
  return jsonResult(statusCode, { ok: true, data, requestId });
}

export function paginatedResponse<T>(
  data: T[],
  page: PageInfo,
  requestId: string,
): ApiGatewayResult {
  return jsonResult(200, { ok: true, data, page, requestId });
}

export function errorResponse(
  code: string,
  message: string,
  details: unknown[] | undefined,
  statusCode: number,
  requestId: string,
): ApiGatewayResult {
  return jsonResult(statusCode, {
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
    requestId,
  });
}
