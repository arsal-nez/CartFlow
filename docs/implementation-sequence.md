# CartFlow Implementation Sequence

## Phase 1: Repository Foundation

1. Create workspace package structure.
2. Add strict shared TypeScript settings.
3. Add formatting, linting, and test scripts.
4. Add GitHub Actions for typecheck, lint, and tests.
5. Confirm frontend and backend can be installed, tested, and built independently.

## Phase 2: Backend Foundation

1. Create `services/api` package.
2. Add strict TypeScript config.
3. Add Lambda handler conventions.
4. Add Middy middleware composition.
5. Add typed environment config parser.
6. Add response and error format helpers.
7. Add Jest setup.

Exit criteria:

- A minimal non-business health endpoint can be tested.
- No application domain code is needed yet.
- Typecheck and tests run in CI.

## Phase 3: Infrastructure Foundation

1. Create Serverless Framework configuration.
2. Define API Gateway HTTP API.
3. Define Lambda deployment packaging.
4. Define DynamoDB table and GSIs.
5. Define S3 image bucket.
6. Define Cognito user pool, app client, and JWT authorizer.
7. Define least-privilege IAM permissions.

Exit criteria:

- Backend can deploy to a dev stage.
- Outputs needed by frontend are documented.

## Phase 4: Product Catalog

1. Define product domain types and Zod schemas.
2. Create product repository interface.
3. Implement DynamoDB product repository.
4. Create product service with status filtering.
5. Implement public product handlers.
6. Add unit and integration tests.

Exit criteria:

- Product list and product detail endpoints support cursor pagination where applicable.

## Phase 5: Admin Product And Inventory

1. Add admin authorization middleware/service checks.
2. Add create/update product use cases.
3. Add inventory repository and service operations.
4. Add conditional inventory updates.
5. Add admin API tests for forbidden and allowed flows.

Exit criteria:

- Admin users can manage product metadata and inventory.
- Non-admin users cannot access admin routes.

## Phase 6: S3 Product Images

1. Add S3 client outside handlers.
2. Add upload URL service.
3. Add content type and size validation.
4. Add presigned URL endpoint.
5. Add product image attachment endpoint.
6. Add tests for authorization, validation, and generated command parameters.

Exit criteria:

- Frontend can upload images without AWS credentials.

## Phase 7: Cart

1. Add cart domain models and schemas.
2. Add cart repository.
3. Add cart service that derives user identity from auth context.
4. Add cart item add/update/delete handlers.
5. Hydrate cart reads with current product data.
6. Add tests for ownership and validation.

Exit criteria:

- Users can manage only their own cart.

## Phase 8: Orders

1. Add order domain models and schemas.
2. Add order repository with transaction support.
3. Add checkout service.
4. Re-read authoritative product prices during checkout.
5. Use conditional inventory decrement.
6. Snapshot purchased item names and prices.
7. Add idempotency handling.
8. Add user order list/detail endpoints with cursor pagination.
9. Add tests for price tampering, inventory conflicts, and ownership.

Exit criteria:

- Orders are created from trusted backend state.
- Inventory cannot go negative under normal concurrent checkout flows.

## Phase 9: Frontend Foundation

1. Create React/Vite TypeScript app.
2. Add strict TypeScript config.
3. Add Cognito auth integration.
4. Add API client that sends JWTs.
5. Add route structure for catalog, cart, orders, and admin.
6. Add frontend test setup.

Exit criteria:

- Frontend can authenticate and call protected backend routes.

## Phase 10: Frontend Features

1. Build catalog browsing.
2. Build product detail.
3. Build cart management.
4. Build checkout flow.
5. Build order history.
6. Build admin product, inventory, and image upload flows.
7. Add component and workflow tests.

Exit criteria:

- End-to-end user journeys are complete against deployed backend.

## Phase 11: Production Readiness

1. Add observability polish.
2. Add deployment workflows.
3. Add environment-specific configuration.
4. Add least-privilege IAM review.
5. Add README deployment guide.
6. Add smoke tests after deployment.

Exit criteria:

- CartFlow can be demonstrated as a full-stack cloud-native portfolio project.

