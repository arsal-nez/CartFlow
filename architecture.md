# CartFlow Architecture

## Purpose

CartFlow is a portfolio-grade, cloud-native e-commerce and inventory application. It is designed to demonstrate a production-minded TypeScript stack across a separately deployable React frontend and AWS serverless backend.

## Target Stack

- Frontend: React, TypeScript, strict TypeScript, Cognito authentication.
- Backend: Node.js, TypeScript, AWS Lambda, API Gateway HTTP API, Middy, Zod.
- Data: DynamoDB with access-pattern-led modeling.
- Storage: S3 for product images using presigned upload URLs.
- Infrastructure: Serverless Framework.
- Testing: Jest for unit tests, Supertest for HTTP-style integration tests.
- CI/CD: GitHub Actions.
- AWS SDK: AWS SDK v3 with `@aws-sdk/lib-dynamodb`.

## High-Level Flow

```text
React frontend
  -> Cognito hosted UI or auth SDK
  -> JWT access/id token
  -> API Gateway HTTP API
  -> Lambda handlers
  -> service layer
  -> repository layer
  -> DynamoDB

Lambda
  -> S3 presigned URLs
  -> S3 image uploads from browser
```

## Deployment Boundaries

The frontend and backend must be independently deployable.

- `apps/frontend`: React application, build artifacts, and frontend-only configuration.
- `services/api`: Lambda handlers, domain services, repositories, validation schemas, middleware, tests.
- `infra`: deployable infrastructure definitions, including Serverless Framework configuration.
- `.github/workflows`: CI/CD pipelines.

The frontend must never receive AWS credentials. It authenticates with Cognito, sends JWTs to the API, and uploads images only through short-lived S3 presigned URLs created by authenticated backend endpoints.

## Backend Layering

Handlers should be thin. They adapt API Gateway events into validated commands and queries, then call services.

```text
handler
  -> middleware
  -> zod request validation
  -> service interface
  -> repository interface
  -> AWS implementation
```

Layer responsibilities:

- Handlers: HTTP event parsing, authentication context extraction, response mapping.
- Middleware: request IDs, logging context, JSON body parsing, auth guard, error normalization.
- Schemas: Zod validation for path params, query params, and request bodies.
- Services: business rules and authorization decisions.
- Repositories: persistence interfaces and DynamoDB implementations.
- Clients/config: AWS SDK clients created once outside Lambda handlers.

Dependency inversion rule:

- Handlers depend on service interfaces or factories.
- Services depend on repository interfaces.
- Repository implementations depend on AWS SDK clients.
- Tests can replace services or repositories with controlled implementations.

## Runtime Configuration

All deploy-time differences must come from environment variables or infrastructure outputs. No account IDs, table names, bucket names, Cognito IDs, or secrets should be hard-coded in source.

AWS SDK clients should be initialized once per Lambda module, outside handler functions, so execution environments can reuse clients across invocations.

## Authentication And Authorization

Authentication:

- React authenticates with Cognito.
- API requests include a Bearer JWT.
- API Gateway HTTP API should use a JWT authorizer where possible.
- Lambda also validates required authorization context before performing protected actions.

Authorization:

- Customer users may manage their own cart and view their own orders.
- Admin users may create/update products, manage inventory, and generate product image upload URLs.
- Backend services must derive user identity and role from verified JWT claims or API Gateway authorizer context.
- Backend must never trust user IDs, roles, prices, totals, stock counts, or ownership claims supplied in request bodies.

## Pricing And Order Integrity

The frontend may display prices, but order creation must read authoritative product prices from DynamoDB. The backend calculates:

- Line item unit prices.
- Line item totals.
- Order subtotal.
- Inventory availability.
- Final order amount.

Requests that include client-side prices should ignore those values or reject the request, depending on endpoint design.

## S3 Image Upload Strategy

Admin product image upload flow:

1. Admin requests an upload URL for a product image.
2. Lambda authorizes the admin and validates content metadata.
3. Lambda creates a short-lived presigned S3 PUT URL.
4. Browser uploads directly to S3.
5. Backend records the image object key or public asset URL against the product after validation.

S3 bucket access should default to private. Public reads should be served through explicit bucket policy, CloudFront, or application-mediated access depending on the final deployment choice.

## API Response Format

Success response:

```json
{
  "ok": true,
  "data": {},
  "requestId": "req_123"
}
```

Paginated response:

```json
{
  "ok": true,
  "data": [],
  "page": {
    "nextCursor": "opaque-cursor-or-null",
    "limit": 20
  },
  "requestId": "req_123"
}
```

Error response:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": []
  },
  "requestId": "req_123"
}
```

## Observability

Minimum backend observability:

- Structured JSON logs.
- Request ID on every response.
- Lambda cold-start-safe client reuse.
- Error codes mapped consistently.
- No secrets or full JWTs in logs.

## Reliability And Security Defaults

- Strict TypeScript across all packages.
- Input validation with Zod at API boundaries.
- Middy middleware for common Lambda concerns.
- Least-privilege IAM per Lambda group.
- DynamoDB conditional writes for stock/order consistency.
- Cursor-based pagination for collection endpoints.
- No fake implementations in production modules.
- Tests should use real module boundaries with explicit fakes/mocks only in test code.

