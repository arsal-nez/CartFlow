# CartFlow API Design

## API Style

CartFlow exposes a JSON HTTP API through API Gateway HTTP API and Lambda. All request and response bodies are JSON unless the endpoint explicitly returns an empty response.

Authentication uses Cognito JWTs. Protected routes require `Authorization: Bearer <jwt>`.

## Shared Response Contract

Success:

```json
{
  "ok": true,
  "data": {},
  "requestId": "req_123"
}
```

Paginated success:

```json
{
  "ok": true,
  "data": [],
  "page": {
    "nextCursor": null,
    "limit": 20
  },
  "requestId": "req_123"
}
```

Error:

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

## Error Codes

| Code | HTTP status | Meaning |
| --- | ---: | --- |
| `VALIDATION_ERROR` | 400 | Request body, path, or query failed Zod validation |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Authenticated user lacks permission |
| `NOT_FOUND` | 404 | Resource does not exist or is not visible to caller |
| `CONFLICT` | 409 | Conditional write failed or resource state conflict |
| `INVENTORY_UNAVAILABLE` | 409 | Requested quantity is not available |
| `RATE_LIMITED` | 429 | Request was throttled |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Public Catalog

### `GET /products`

Lists active products.

Query parameters:

- `categoryId`: optional string.
- `limit`: optional number, server capped.
- `cursor`: optional opaque pagination cursor.

Returns paginated product summaries.

### `GET /products/{productId}`

Gets a single active product and current inventory availability summary.

Returns product detail.

## Customer Cart

All cart routes require authentication.

### `GET /cart`

Gets the authenticated user's cart with product details hydrated by the backend.

The backend derives `userId` from verified auth context.

### `PUT /cart/items/{productId}`

Adds or replaces a cart item quantity.

Body:

```json
{
  "quantity": 2
}
```

Rules:

- Quantity must be a positive integer.
- Backend validates product existence and status.
- Backend may validate basic inventory availability, but checkout remains authoritative.

### `DELETE /cart/items/{productId}`

Removes an item from the authenticated user's cart.

## Customer Orders

All order routes require authentication.

### `POST /orders`

Creates an order from the authenticated user's current cart.

Body:

```json
{
  "idempotencyKey": "client-generated-key"
}
```

Rules:

- Backend loads the cart from DynamoDB.
- Backend reads authoritative product prices.
- Backend validates inventory availability.
- Backend calculates totals.
- Backend writes order and decrements inventory transactionally where possible.
- Client-supplied prices, totals, user IDs, and roles are ignored or rejected.

### `GET /orders`

Lists the authenticated user's orders.

Query parameters:

- `limit`: optional number, server capped.
- `cursor`: optional opaque pagination cursor.

### `GET /orders/{orderId}`

Gets a single order owned by the authenticated user. Admin users may be allowed to view any order if required.

## Admin Products

Admin routes require authentication and admin authorization.

### `POST /admin/products`

Creates a product.

Body:

```json
{
  "name": "Trail Bottle",
  "description": "Insulated bottle",
  "categoryId": "drinkware",
  "priceCents": 2499,
  "currency": "USD",
  "status": "DRAFT"
}
```

### `PATCH /admin/products/{productId}`

Updates editable product fields.

Rules:

- Product ID is path-derived.
- Price changes affect future orders only.
- Existing order item snapshots are immutable.

### `POST /api/v1/uploads/presigned-url`

Admin only ([backend/src/handlers/uploads/create-presigned-url.ts](../backend/src/handlers/uploads/create-presigned-url.ts)). Creates a presigned S3 `PUT` URL for a product image. The Lambda never touches the image bytes — see "Browser Upload Flow" below and `docs/database.md`, "Upload Consistency And Security", for exactly what this endpoint does and does not enforce.

Body:

```json
{
  "contentType": "image/png",
  "contentLength": 250000
}
```

There is no `fileName` field: the object key is generated entirely server-side (a random id, never a client-supplied name), so there is nothing for a file name to influence. See docs/database.md for why.

Returns:

```json
{
  "ok": true,
  "data": {
    "key": "products/3f9c1b2a-....png",
    "uploadUrl": "https://cartflow-dev-product-images.s3.amazonaws.com/products/3f9c1b2a-....png?X-Amz-...",
    "method": "PUT",
    "headers": { "Content-Type": "image/png" },
    "expiresInSeconds": 300
  },
  "requestId": "req_123"
}
```

Rules:

- Only `image/jpeg`, `image/png`, and `image/webp` are accepted (`VALIDATION_ERROR` otherwise).
- `contentLength` beyond the configured `MAX_UPLOAD_BYTES` (default 5 MB) is rejected before a URL is generated.
- The upload URL expires after `UPLOAD_URL_EXPIRES_SECONDS` (default 300s).
- The client never supplies (and the API never accepts) an already-hosted image URL as a substitute for uploading — every product image reference originates from a key this endpoint generated.

### `POST /api/v1/products/{id}/images` (not yet implemented)

Planned follow-up step: attaches an S3 object key — obtained only from the endpoint above, after the browser's direct upload to S3 succeeds — to a product. Never accepts an arbitrary URL, only a `key` this API previously generated.

```json
{
  "key": "products/3f9c1b2a-....png"
}
```

## Admin Inventory

Admin routes require authentication and admin authorization.

### `GET /admin/inventory`

Lists inventory records.

Query parameters:

- `stockStatus`: optional `IN_STOCK | LOW | OUT_OF_STOCK`.
- `limit`: optional number, server capped.
- `cursor`: optional opaque pagination cursor.

### `PATCH /admin/products/{productId}/inventory`

Updates inventory for a product.

Body:

```json
{
  "availableQuantity": 42,
  "reorderThreshold": 5
}
```

Rules:

- Backend owns stock status calculation.
- Use conditional writes to avoid stale updates where needed.

## Validation

Every endpoint must define Zod schemas for:

- Path parameters.
- Query parameters.
- Request body.
- Optional response DTOs for testable serialization contracts.

Invalid requests should never reach business services.

## Supertest Strategy

Supertest should exercise the HTTP adapter shape with:

- Success cases.
- Zod validation failures.
- Auth failures.
- Authorization failures.
- Repository/service error mapping.
- Pagination cursor behavior.

