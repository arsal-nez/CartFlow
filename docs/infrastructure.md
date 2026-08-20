# CartFlow AWS Infrastructure

The backend infrastructure is defined in `backend/serverless.yml` with stage-specific settings in `backend/config/dev.yml` and `backend/config/prod.yml`.

## Stages

- `dev`: lower-cost defaults, shorter log retention, removable stateful resources.
- `prod`: retained stateful resources, DynamoDB point-in-time recovery, S3 versioning, longer log retention.

Run the resolved configuration with:

```bash
cd backend
npx serverless print --stage dev
```

## API Gateway HTTP API

Serverless creates an HTTP API for Lambda routes. CORS is configured per stage from `config/<stage>.yml`.

Routes will be added incrementally. The only current route is `GET /health`, which exists so packaging and API wiring can be validated without implementing business logic.

The infrastructure also defines a Cognito JWT authorizer named `cognitoJwt` for future protected routes.

## Lambda

Lambda uses Node.js 18 on arm64. Runtime configuration is supplied through environment variables generated from CloudFormation references and stage config:

- `CARTFLOW_TABLE_NAME`
- `PRODUCT_IMAGES_BUCKET_NAME`
- `COGNITO_USER_POOL_ID`
- `COGNITO_APP_CLIENT_ID`
- `JWT_ISSUER`
- `ALLOWED_ORIGINS`
- `UPLOAD_URL_EXPIRES_SECONDS`
- `MAX_UPLOAD_BYTES`
- `DEFAULT_PAGE_LIMIT`
- `MAX_PAGE_LIMIT`
- `ADMIN_GROUP_NAME`
- `CUSTOMER_GROUP_NAME`

## DynamoDB

The `CartFlowTable` resource uses a single-table design with:

- Partition key: `PK`
- Sort key: `SK`
- GSI partition key: `GSI1PK`
- GSI sort key: `GSI1SK`

The table uses on-demand billing and server-side encryption. Point-in-time recovery is enabled in `prod` and disabled in `dev`.

## S3

The `ProductImagesBucket` resource is private by default:

- Public ACLs blocked.
- Public policies blocked.
- Public ACLs ignored.
- Public buckets restricted.
- Bucket owner enforced object ownership.
- AES-256 server-side encryption.

CORS allows browser `PUT` uploads from configured frontend origins only. Lifecycle rules abort incomplete multipart uploads after one day and expire temporary `tmp/` uploads.

## Cognito

The stack creates:

- A Cognito User Pool.
- A public web User Pool Client with authorization-code OAuth flow.
- A `customer` group for standard users.
- An `admin` group for users allowed to manage products, inventory, and image upload URLs.

Application authorization should check the verified JWT groups claim. Infrastructure creates the groups, but users should be assigned to groups through an admin workflow or operational process.

## IAM

The Lambda execution role uses explicit actions and resource-scoped permissions:

- DynamoDB read/write actions on the application table.
- DynamoDB `Query` on `GSI1`.
- S3 object read/write actions under the `products/` prefix.
- S3 bucket location lookup on the product images bucket.

Wildcard IAM actions are not used. The S3 object resource uses a prefix wildcard because object-level IAM resources require it.

## Deployment Configuration

Stage configuration lives in:

- `backend/config/dev.yml`
- `backend/config/prod.yml`

Each stage defines a `resourceSuffix` used in globally named resources such as S3 buckets. For real production deployment, replace the sample suffix with a project/account-specific value before deploying.

Environment examples live in:

- `backend/env/dev.env.example`
- `backend/env/prod.env.example`

Deploy examples:

```bash
cd backend
npx serverless deploy --stage dev
npx serverless deploy --stage prod
```
