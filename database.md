# CartFlow Database Design

## DynamoDB Approach

CartFlow uses DynamoDB as the system of record for catalog, inventory, carts, and orders. The design should be driven by access patterns, not relational normalization.

The recommended first implementation is a single-table design because it demonstrates realistic serverless modeling and allows efficient transactional workflows. If a later requirement adds analytics, full-text search, or complex ad hoc reporting, those concerns should be handled by purpose-built projections, not by weakening the transactional model.

## Table

Table name comes from `CARTFLOW_TABLE_NAME`.

Primary key:

- `PK`: string
- `SK`: string

Recommended indexes:

- `GSI1PK`, `GSI1SK`: category and status product listings.
- `GSI2PK`, `GSI2SK`: user order history and admin order lookup.
- `GSI3PK`, `GSI3SK`: low-stock/admin inventory views if needed.

All timestamps should be ISO-8601 strings in UTC.

## Core Entities

Product metadata:

```text
PK = PRODUCT#{productId}
SK = META
GSI1PK = PRODUCTS#STATUS#{status}
GSI1SK = CATEGORY#{categoryId}#NAME#{normalizedName}#PRODUCT#{productId}
```

Inventory:

```text
PK = PRODUCT#{productId}
SK = INVENTORY
GSI3PK = INVENTORY#STATUS#{stockStatus}
GSI3SK = AVAILABLE#{availableQuantityPadded}#PRODUCT#{productId}
```

Cart:

```text
PK = USER#{userId}
SK = CART
```

Cart item:

```text
PK = USER#{userId}
SK = CART#ITEM#{productId}
```

Order:

```text
PK = ORDER#{orderId}
SK = META
GSI2PK = USER#{userId}#ORDERS
GSI2SK = CREATED#{createdAt}#ORDER#{orderId}
```

Order item:

```text
PK = ORDER#{orderId}
SK = ITEM#{productId}
```

Upload record:

```text
PK = PRODUCT#{productId}
SK = IMAGE#{imageId}
```

## Access Patterns

| Access pattern | Key strategy |
| --- | --- |
| Get product by ID | `PK=PRODUCT#{productId}`, `SK=META` |
| List active products | `GSI1PK=PRODUCTS#STATUS#ACTIVE` |
| List active products by category | `GSI1PK=PRODUCTS#STATUS#ACTIVE`, `begins_with(GSI1SK, CATEGORY#{categoryId})` |
| Get inventory for product | `PK=PRODUCT#{productId}`, `SK=INVENTORY` |
| Get user's cart | Query `PK=USER#{userId}`, `begins_with(SK, CART)` |
| Update cart item | Put/delete `PK=USER#{userId}`, `SK=CART#ITEM#{productId}` |
| Create order | Transact write order, order items, cart cleanup, inventory conditional updates |
| Get order by ID | Query `PK=ORDER#{orderId}` |
| List user's orders | Query `GSI2PK=USER#{userId}#ORDERS` |
| Admin list low-stock products | Query `GSI3PK=INVENTORY#STATUS#LOW` |
| Attach product image | Put `PK=PRODUCT#{productId}`, `SK=IMAGE#{imageId}` and update product metadata |

## Cursor-Based Pagination

Collection endpoints should use DynamoDB `LastEvaluatedKey` as the source for pagination cursors.

Cursor rules:

- Cursor values must be opaque to clients.
- Encode the DynamoDB exclusive start key as URL-safe base64 JSON.
- Validate cursor shape before using it.
- Do not expose raw partition strategy as public API contract.
- Enforce server-side maximum limits.

## Consistency Rules

Product pricing:

- Product price is read from DynamoDB during order creation.
- Client-provided price and total values are not trusted.

Inventory:

- Inventory updates should use conditional writes.
- Order creation should fail if available quantity is insufficient.
- Stock decrement and order creation should be in a DynamoDB transaction where possible.

Cart:

- Cart items should store product IDs and requested quantities.
- Cart display may hydrate current product name, image, and price from product records.
- Checkout must re-read current product and inventory records.

Orders:

- Order line items should snapshot authoritative product name and unit price at purchase time.
- Order totals should be calculated by backend services.

## Suggested Attributes

Product:

- `productId`
- `name`
- `normalizedName`
- `description`
- `categoryId`
- `status`: `ACTIVE | DRAFT | ARCHIVED`
- `priceCents`
- `currency`
- `imageKeys`
- `createdAt`
- `updatedAt`

Inventory:

- `productId`
- `availableQuantity`
- `reservedQuantity`
- `reorderThreshold`
- `stockStatus`: `IN_STOCK | LOW | OUT_OF_STOCK`
- `updatedAt`

Cart item:

- `userId`
- `productId`
- `quantity`
- `createdAt`
- `updatedAt`

Order:

- `orderId`
- `userId`
- `status`: `CREATED | PAID | CANCELLED | FULFILLED`
- `subtotalCents`
- `currency`
- `createdAt`
- `updatedAt`

Order item:

- `orderId`
- `productId`
- `nameSnapshot`
- `unitPriceCents`
- `quantity`
- `lineTotalCents`

Image:

- `imageId`
- `productId`
- `bucket`
- `key`
- `contentType`
- `status`: `PENDING_UPLOAD | UPLOADED | ATTACHED`
- `createdAt`

## DynamoDB Operational Notes

- Use on-demand billing for early portfolio deployment unless predictable traffic justifies provisioned capacity.
- Enable point-in-time recovery for non-demo environments.
- Consider TTL for stale upload records and abandoned carts if needed.
- Keep item sizes below DynamoDB limits by storing image objects in S3, not in table attributes.

