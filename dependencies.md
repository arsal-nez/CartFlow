# CartFlow Dependency List

This document lists planned dependencies only. Package manifests should be created during implementation when each package boundary is introduced.

## Root Tooling

Planned purpose:

- Workspace orchestration.
- Shared TypeScript and lint/test commands.
- CI-friendly scripts.

Candidate dev dependencies:

- `typescript`
- `tsx`
- `eslint`
- `prettier`
- `jest`
- `ts-jest`
- `@types/jest`

## Frontend

Runtime dependencies:

- `react`
- `react-dom`
- `react-router-dom`
- `@aws-amplify/auth` or `aws-amplify` for Cognito auth integration.
- `zod` for client-side form/API DTO validation where useful.

Dev dependencies:

- `vite`
- `@vitejs/plugin-react`
- `typescript`
- `vitest` or `jest`, to be decided before frontend test setup.
- `@testing-library/react`
- `@testing-library/jest-dom`
- `@testing-library/user-event`
- `jsdom`

Notes:

- The frontend must not depend on AWS SDK credentialed clients.
- The frontend should call backend APIs with JWTs only.

## Backend API

Runtime dependencies:

- `@aws-sdk/client-dynamodb`
- `@aws-sdk/lib-dynamodb`
- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `@middy/core`
- `@middy/http-json-body-parser`
- `@middy/http-error-handler`
- `@middy/http-cors`
- `zod`
- `nanoid` or `uuid` for IDs, to be selected during implementation.

Dev dependencies:

- `typescript`
- `tsx`
- `jest`
- `ts-jest`
- `supertest`
- `@types/supertest`
- `@types/aws-lambda`
- `@types/node`
- `serverless`
- `serverless-esbuild` or an equivalent TypeScript bundling plugin.
- `serverless-offline` if local HTTP testing is required.

Notes:

- AWS SDK clients must be created outside Lambda handlers.
- DynamoDB access should use `DynamoDBDocumentClient` from `@aws-sdk/lib-dynamodb`.
- Tests should mock repository interfaces or AWS SDK command sends explicitly where appropriate.

## Infrastructure

Serverless Framework plugins:

- `serverless-esbuild` for TypeScript bundling.
- Optional `serverless-offline` for local API execution.
- Optional pruning/plugin support if deployment hygiene is desired.

AWS resources:

- API Gateway HTTP API.
- Lambda functions.
- DynamoDB table and GSIs.
- S3 product image bucket.
- Cognito user pool, app client, and authorizer.
- IAM roles with least-privilege permissions.

## CI/CD

GitHub Actions should run:

- Install dependencies.
- Typecheck.
- Lint.
- Unit tests.
- Integration tests.
- Build frontend.
- Package backend.

Deployment workflows can be added after environment/account decisions are made.

