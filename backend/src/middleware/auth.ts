import type { MiddlewareObj } from '@middy/core';

import { UnauthorizedError } from '../errors/app-error';
import type { ApiGatewayEvent, ApiGatewayResult, AuthContext } from '../types/http';

export type { AuthContext } from '../types/http';

/**
 * Cognito-based authentication for CartFlow.
 *
 * API Gateway HTTP API verifies the caller's JWT (signature, expiry, issuer,
 * audience) before a Lambda ever runs — that's the `cognitoJwt` authorizer
 * in `serverless.yml`. On success, API Gateway forwards the decoded token
 * claims to the Lambda as `event.requestContext.authorizer.jwt.claims`, a
 * flat `Record<string, string>`. This module is the only place that reads
 * those claims: every other layer gets the caller's identity through
 * `getCurrentUser()` / `event.auth`, never by trusting a `userId` a client
 * put in a request body or query string.
 */

/**
 * Parses the `cognito:groups` claim, which API Gateway's JWT authorizer
 * flattens to a string. Cognito ID tokens carry it as a JSON array, so a
 * single-group token often round-trips as `["admin"]`; a comma-separated
 * fallback covers other shapes without over-fitting to one format.
 */
function parseGroups(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      // Not JSON after all — fall through to comma-splitting below.
    }
  }
  return trimmed
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
}

/**
 * Reads the verified caller identity out of the API Gateway JWT authorizer
 * context — `sub` for the user id, `cognito:groups` for role membership
 * (`admin` vs. plain authenticated/"customer"). Returns `null` when the
 * route has no authorizer attached or the token carried no `sub` claim.
 *
 * This is the *only* source of truth for "who is calling": nothing in
 * CartFlow's handlers, services, or repositories derives a user id from
 * request bodies, query strings, or path parameters.
 */
export function getCurrentUser(event: ApiGatewayEvent): AuthContext | null {
  const claims = event.requestContext.authorizer?.jwt.claims;
  const userId = claims?.['sub'];
  if (userId === undefined || userId.trim() === '') {
    return null;
  }
  return { userId, groups: parseGroups(claims?.['cognito:groups']) };
}

/**
 * Middy middleware: requires any authenticated caller (401 `UNAUTHORIZED`
 * otherwise) and attaches the identity to `event.auth` for the handler.
 * Any Cognito user — customer or admin — satisfies this; use `requireAdmin()`
 * from `./admin` for admin-only routes.
 */
export function requireAuthentication(): MiddlewareObj<ApiGatewayEvent, ApiGatewayResult> {
  return {
    before: (request) => {
      request.event.auth = requireCurrentUser(request.event);
    },
  };
}

/**
 * Same lookup as `getCurrentUser()`, but throws `UnauthorizedError` instead
 * of returning `null`. Handlers call this after `requireAuthentication()`
 * has already run — it should never actually be null there — so a throw
 * here surfaces as a correct 401 rather than a confusing crash if the
 * middleware chain is ever misconfigured.
 */
export function requireCurrentUser(event: ApiGatewayEvent): AuthContext {
  const user = getCurrentUser(event);
  if (user === null) {
    throw new UnauthorizedError();
  }
  return user;
}
