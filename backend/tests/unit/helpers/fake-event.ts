import type { Context } from 'aws-lambda';

import type { ApiGatewayEvent } from '../../../src/types/http';

export interface BuildEventOptions {
  method?: string;
  path?: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  /** Serialized to JSON automatically unless `rawBody` is used. */
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  /**
   * JWT authorizer claims. Omit entirely to simulate an unauthenticated
   * request (no authorizer attached / no Bearer token). Cognito ID tokens
   * carry `cognito:groups` as a JSON array, so most tests pass e.g.
   * `{ sub: 'user-1', 'cognito:groups': '["admin"]' }`.
   */
  claims?: Record<string, string>;
  requestId?: string;
}

/** Builds a minimal, typed API Gateway HTTP API (v2) proxy event for handler tests. */
export function buildEvent(options: BuildEventOptions = {}): ApiGatewayEvent {
  const method = options.method ?? 'GET';
  const path = options.path ?? '/api/v1/products';
  const requestId = options.requestId ?? 'req-test-1';

  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
    ...(options.queryStringParameters === undefined
      ? {}
      : { queryStringParameters: options.queryStringParameters }),
    ...(options.pathParameters === undefined ? {} : { pathParameters: options.pathParameters }),
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'jest-test-agent',
      },
      requestId,
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '20/Aug/2026:00:00:00 +0000',
      timeEpoch: 1_755_648_000_000,
      ...(options.claims === undefined
        ? {}
        : { authorizer: { jwt: { claims: options.claims, scopes: null } } }),
    },
    isBase64Encoded: false,
    ...(body === undefined ? {} : { body }),
  } as unknown as ApiGatewayEvent;
}

export const fakeLambdaContext = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-function',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
  memoryLimitInMB: '128',
  awsRequestId: 'ctx-request-id',
  logGroupName: '/aws/lambda/test-function',
  logStreamName: 'test-stream',
  getRemainingTimeInMillis: () => 30_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
} as unknown as Context;

export function parseBody(result: { body?: string | null | undefined }): Record<string, unknown> {
  if (result.body === undefined || result.body === null) {
    throw new Error('Response has no body');
  }
  return JSON.parse(result.body) as Record<string, unknown>;
}
