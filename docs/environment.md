# CartFlow Environment Variables

Environment variables are the contract between code and deployment. Application code should read configuration through typed config modules, not scattered `process.env` calls.

## Backend API

Required:

| Variable | Example | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | Runtime mode |
| `AWS_REGION` | `us-east-1` | AWS region for SDK clients |
| `CARTFLOW_TABLE_NAME` | `cartflow-dev` | DynamoDB table name |
| `PRODUCT_IMAGES_BUCKET_NAME` | `cartflow-dev-product-images` | S3 bucket for product images |
| `COGNITO_USER_POOL_ID` | `us-east-1_abc123` | Cognito user pool |
| `COGNITO_APP_CLIENT_ID` | `abc123client` | Cognito app client |
| `JWT_ISSUER` | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123` | Expected JWT issuer |
| `ALLOWED_ORIGINS` | `http://localhost:5173,https://example.com` | CORS origin allowlist |
| `UPLOAD_URL_EXPIRES_SECONDS` | `300` | Presigned upload URL lifetime |
| `MAX_UPLOAD_BYTES` | `5242880` | Maximum accepted product image size |

Optional:

| Variable | Example | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | Structured logging verbosity |
| `DEFAULT_PAGE_LIMIT` | `20` | Default collection page size |
| `MAX_PAGE_LIMIT` | `100` | Maximum collection page size |
| `ADMIN_GROUP_NAME` | `admin` | Cognito group used for admin authorization |

## Frontend

Required:

| Variable | Example | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `https://api.example.com` | API Gateway base URL |
| `VITE_COGNITO_USER_POOL_ID` | `us-east-1_abc123` | Cognito user pool |
| `VITE_COGNITO_APP_CLIENT_ID` | `abc123client` | Cognito app client |
| `VITE_COGNITO_REGION` | `us-east-1` | Cognito region |
| `VITE_COGNITO_DOMAIN` | `cartflow.auth.us-east-1.amazoncognito.com` | Cognito hosted UI domain if used |
| `VITE_COGNITO_REDIRECT_SIGN_IN` | `http://localhost:5173/auth/callback` | Sign-in redirect |
| `VITE_COGNITO_REDIRECT_SIGN_OUT` | `http://localhost:5173/` | Sign-out redirect |

Forbidden in frontend:

- AWS access keys.
- AWS secret keys.
- AWS session tokens.
- DynamoDB table names.
- S3 write credentials.
- Backend-only secrets.

## GitHub Actions Secrets

Deployment secrets should be added only when deployment workflows are created.

Candidate secrets:

- `AWS_ROLE_TO_ASSUME`
- `AWS_REGION`
- `FRONTEND_DEPLOY_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`

Prefer OpenID Connect role assumption over long-lived AWS access keys.

## Validation Rules

- Backend config should fail fast on missing or malformed required variables.
- Numeric values should be parsed and range-checked.
- CSV values such as `ALLOWED_ORIGINS` should be parsed into arrays.
- Frontend should only expose variables prefixed with `VITE_`.

