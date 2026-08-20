# CartFlow Folder Structure

## Target Structure

```text
CartFlow/
  apps/
    frontend/
      src/
        app/
        auth/
        api/
        components/
        features/
        routes/
        styles/
        test/
  services/
    api/
      src/
        clients/
        config/
        domain/
        errors/
        handlers/
        middleware/
        repositories/
        responses/
        schemas/
        services/
        utils/
      tests/
        integration/
        unit/
  infra/
    serverless/
  scripts/
  .github/
    workflows/
```

## Directory Responsibilities

- `apps/frontend`: independently deployable React application.
- `apps/frontend/src/auth`: Cognito sign-in state, token handling, and auth-aware UI helpers.
- `apps/frontend/src/api`: API client wrappers that attach JWTs but never AWS credentials.
- `apps/frontend/src/features`: domain-specific React views such as catalog, cart, orders, and admin inventory.
- `services/api`: independently deployable Lambda backend.
- `services/api/src/clients`: AWS SDK v3 clients initialized outside handlers.
- `services/api/src/config`: environment variable parsing and typed runtime config.
- `services/api/src/domain`: shared domain types and value rules.
- `services/api/src/errors`: typed application errors.
- `services/api/src/handlers`: Lambda/API Gateway handler entry points.
- `services/api/src/middleware`: Middy middleware composition.
- `services/api/src/repositories`: repository interfaces and DynamoDB implementations.
- `services/api/src/responses`: consistent success and error response helpers.
- `services/api/src/schemas`: Zod request validation schemas.
- `services/api/src/services`: business use cases and authorization-sensitive logic.
- `services/api/tests/unit`: isolated service, schema, mapper, and repository tests.
- `services/api/tests/integration`: HTTP-shaped tests using Supertest.
- `infra/serverless`: Serverless Framework service definitions and infrastructure configuration.
- `scripts`: developer automation that is not runtime application code.
- `.github/workflows`: CI/CD workflows.

## Current Bootstrap

This repository currently contains the target directories with `.gitkeep` placeholders only. Application modules, package manifests, infrastructure templates, and workflow files should be added during the implementation sequence.

