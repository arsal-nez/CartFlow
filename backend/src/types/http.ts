import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

/**
 * Shape of API Gateway HTTP API's `$context.authorizer` when a `jwt` (Cognito)
 * authorizer is attached to the route. Claims are always strings — API Gateway
 * flattens the token payload, including array claims like `cognito:groups`.
 */
export interface JwtAuthorizerContext {
  jwt: {
    claims: Record<string, string | undefined>;
    scopes: string[] | null;
  };
}

/** Verified caller identity, populated by the `adminGuard()` middleware. */
export interface AuthContext {
  userId: string;
  groups: string[];
}

/**
 * Typed Lambda proxy event for this API. `authorizer` is optional because
 * public routes have no authorizer attached; `validated` and `auth` are
 * populated in place by the `validate()` and `adminGuard()` middlewares, the
 * same way `@middy/http-json-body-parser` replaces `event.body`.
 */
export type ApiGatewayEvent = Omit<APIGatewayProxyEventV2, 'requestContext'> & {
  requestContext: APIGatewayProxyEventV2['requestContext'] & {
    authorizer?: JwtAuthorizerContext;
  };
  /** Set by `validate()`. Read with `requireValidated<T>(event)`. */
  validated?: unknown;
  /** Set by `adminGuard()` once the caller's identity has been verified. */
  auth?: AuthContext;
};

export type ApiGatewayResult = APIGatewayProxyStructuredResultV2;
