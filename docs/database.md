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

## Implemented Data Access Layer

The repositories in `backend/src/repositories/` are the only code allowed to build
DynamoDB commands. Each is a factory (`createProductRepository`, `createCartRepository`,
`createInventoryRepository`) that takes an injected `DynamoDBDocumentClient`, table name,
and clock, and returns a typed interface (`ProductRepository`, `CartRepository`,
`InventoryRepository`). Handlers depend on the interface, never on the SDK.

Shared plumbing lives in `backend/src/lib/dynamodb.ts`: the `DynamoDBDocumentClient`
singleton, `CARTFLOW_TABLE_NAME` resolution, cursor encode/decode, key padding, and
error classification helpers.

**No `Scan` command exists anywhere in the layer.** Every read below is a `GetItem`
or a `Query` against the base table or GSI1.

### Index status

Only `GSI1` is provisioned today (`backend/serverless.yml`). Inventory items are written
with `GSI3PK`/`GSI3SK` already populated so the low-stock admin view can be enabled by
adding the index without a backfill; until then those attributes are inert, and no
repository method queries GSI3. GSI2 (orders) is not written by this layer.

### Product access patterns

| Method | Command | Keys and conditions |
| --- | --- | --- |
| `create(input)` | `PutCommand` | Item at `PK=PRODUCT#{productId}`, `SK=META`, with `GSI1PK=PRODUCTS#STATUS#{status}` and `GSI1SK=CATEGORY#{categoryId}#NAME#{normalizedName}#PRODUCT#{productId}`. `ConditionExpression: attribute_not_exists(PK) AND attribute_not_exists(SK)` makes create idempotent-safe: a duplicate id raises `ConflictError` instead of silently overwriting a live product. Status defaults to `DRAFT`, so a half-built product never lands in the active listing partition. |
| `getById(productId)` | `GetCommand` | `PK=PRODUCT#{productId}`, `SK=META`. Single-item read, 0.5 RCU, eventually consistent. Returns `null` rather than throwing so callers can distinguish "missing" from "failed". |
| `list({status, limit, cursor})` | `QueryCommand` on `GSI1` | `GSI1PK = PRODUCTS#STATUS#{status}` (default `ACTIVE`). Status is part of the partition key, so listing active products touches only active items — no filter expression, no scan, and archived products cost nothing to skip. Results come back in `GSI1SK` order, which is category then normalized name, giving a stable alphabetical catalog. |
| `listByCategory({categoryId, status, limit, cursor})` | `QueryCommand` on `GSI1` | Same partition plus `begins_with(GSI1SK, CATEGORY#{categoryId}#)`. Because category is the leading `GSI1SK` segment, a category page is one contiguous range read. The trailing `#` in the prefix prevents `c-1` from matching `c-10`. |
| `update(productId, patch)` | `GetCommand` then `UpdateCommand` | Read-modify-write on `PK=PRODUCT#{productId}`, `SK=META`. The read is required because `GSI1PK`/`GSI1SK` are derived from status, category, and name: a partial patch still has to rewrite both index keys consistently. The write carries `ConditionExpression: attribute_exists(PK) AND updatedAt = :expectedUpdatedAt`, an optimistic lock against the value just read, and returns `ALL_NEW`. A lost race raises `ConflictError`; a caller-supplied stale `expectedUpdatedAt` is rejected before any write. |
| `deactivate(productId)` | `UpdateCommand` (via `update`) | Sets `status = ARCHIVED` and rewrites `GSI1PK` to `PRODUCTS#STATUS#ARCHIVED`. The item leaves the active listing partition immediately while order history that references it keeps resolving through `getById`. This is the preferred removal path. |
| `delete(productId)` | `DeleteCommand` | `PK=PRODUCT#{productId}`, `SK=META`, guarded by `attribute_exists(PK)` so deleting a missing product raises `NotFoundError`. Hard delete removes the metadata item only; sibling items in the same partition (inventory, images) are untouched, which is why `deactivate` is the default for catalog operations. |

### Cart access patterns

The cart header and every cart line share partition `USER#{userId}`, so the whole cart
is one Query and one transaction.

| Method | Command | Keys and conditions |
| --- | --- | --- |
| `getCart(userId)` | `QueryCommand` | `PK = USER#{userId} AND begins_with(SK, CART)`. `CART` is a prefix of `CART#ITEM#{productId}`, so a single query returns the header and all lines together; the header is identified by `SK = CART` exactly. The repository follows `LastEvaluatedKey` to exhaustion so a large cart is never silently truncated. Returns `null` when no header item exists. |
| `createCart(input)` | `PutCommand` | Header item at `PK=USER#{userId}`, `SK=CART`, guarded by `attribute_not_exists(PK) AND attribute_not_exists(SK)` so re-issuing create cannot wipe an existing cart's currency or `createdAt`. Raises `ConflictError` if a cart is already there. |
| `updateCart(input)` | `QueryCommand` then `TransactWriteCommand` | Full replacement of cart contents. The current cart is read first to determine which lines are new, changed, or gone. The transaction always starts with an `Update` of the header (`SET updatedAt`) conditioned on `attribute_exists(PK) AND updatedAt = :expectedUpdatedAt` — that single condition is the optimistic lock for the entire cart, so two concurrent cart edits cannot interleave. Then one `Put` per surviving line (`SK=CART#ITEM#{productId}`, preserving the original `createdAt`), and one `Delete` per line the caller omitted or set to quantity `0`. A zero-quantity line for a product that was never in the cart emits no write. Input is validated first: no duplicate product ids, no negative or fractional quantities, no `#` in a product id. Since DynamoDB caps a transaction at 100 actions, a cart update needing more than that is rejected with `ValidationError` instead of partially applying. A cancelled transaction whose reason is `ConditionalCheckFailed` becomes `ConflictError`; other cancellation reasons (throttling) propagate unchanged so they can be retried. |

Cart lines store only `productId` and `quantity`. Names, images, and prices are hydrated
from product records at display time and re-read at checkout — the cart never becomes a
stale price source.

### Inventory access patterns

Inventory lives at `SK=INVENTORY` in the same partition as the product metadata item,
so checkout can read product and stock together and write both in one transaction.

| Method | Command | Keys and conditions |
| --- | --- | --- |
| `getInventory(productId, {consistentRead})` | `GetCommand` | `PK=PRODUCT#{productId}`, `SK=INVENTORY`. Defaults to an eventually consistent read for display. Pass `consistentRead: true` before any stock decision — an eventually consistent read can oversell. |
| `updateInventory(productId, input)` | `GetCommand` (consistent) then `UpdateCommand`, or `PutCommand` when absent | Conditional read-modify-write. The read is strongly consistent. The write sets `availableQuantity`, `reservedQuantity`, `reorderThreshold`, the derived `stockStatus`, and the derived `GSI3PK`/`GSI3SK`, under `ConditionExpression: attribute_exists(PK) AND availableQuantity = :expectedAvailableQuantity AND reservedQuantity = :expectedReservedQuantity`. Conditioning on the counters themselves — not just a timestamp — means a concurrent sale that already consumed the stock this write was based on fails the write rather than resurrecting it, and the caller retries against fresh numbers. Raises `ConflictError` on a lost race. |

Input rules for `updateInventory`:

- Absolute values (`availableQuantity`) and deltas (`availableQuantityDelta`) are mutually exclusive per counter; supplying both is a `ValidationError`.
- Deltas are computed against the consistent read, and a result below zero is rejected before any write — stock can never go negative.
- `stockStatus` is derived, never client-supplied: `0` is `OUT_OF_STOCK`, at or below `reorderThreshold` is `LOW`, otherwise `IN_STOCK`.
- `GSI3SK` pads the available quantity to 12 digits so quantities sort numerically inside the status partition.
- When no inventory record exists, an absolute `availableQuantity` initialises it via a `PutCommand` guarded by `attribute_not_exists(PK)`. A delta against a missing record is a `ValidationError`, because "add 5" to unknown stock has no defined meaning.

### Why no Scan

Every listing is anchored to a known partition key: products by status partition on GSI1,
carts by `USER#{userId}`, inventory by `PRODUCT#{productId}`. A `Scan` would read the whole
table to serve any of them, cost grows with total table size rather than result size, and it
returns other entity types that then need filtering. If a future requirement genuinely needs
unanchored search (full-text catalog search, ad hoc reporting), it belongs in a purpose-built
projection — OpenSearch or an analytics export — not a table scan.

### Error mapping

| Repository outcome | Error | HTTP status |
| --- | --- | --- |
| Item does not exist where one is required | `NotFoundError` | 404 |
| `ConditionalCheckFailedException`, or a transaction cancelled by `ConditionalCheckFailed` | `ConflictError` | 409 |
| Input that cannot form a valid write (bad limit, duplicate cart line, negative stock, `#` in an identifier) | `ValidationError` | 400 |
| Requested cart quantity exceeds `Inventory.availableQuantity` | `InventoryUnavailableError` | 409 |

Identifiers must not contain `#`: it is the key-segment delimiter, and an unchecked `#`
in a product or category id would let a caller forge a key that collides with another
entity. Product names are normalized to lower-case alphanumerics and `-` for the same
reason before they enter `GSI1SK`.

## Cart Concurrency And Consistency

The Cart API (`backend/src/services/cart.service.ts`, `backend/src/handlers/cart/`)
sits on top of the repository primitives described above. This section documents the
concurrency and consistency decisions specific to that service — what is safe to race,
what is not, and why.

### Identity: never trust a client-supplied user id

Every cart method takes `userId` as a parameter, but the only caller that may supply it
is a handler, and every handler reads it from `requireCurrentUser(event)` —
`backend/src/middleware/auth.ts` — which reads the Cognito JWT's verified `sub` claim
via API Gateway's `jwt` authorizer. No cart schema (`backend/src/schemas/cart.schema.ts`)
has a `userId` field, so there is no request field to trust or distrust: a client
sending `{ "userId": "someone-else" }` in a body has that key silently dropped by Zod's
default "unknown keys stripped" behavior, and the handler never reads it. There is also
no `userId` path parameter on any cart route (`/cart`, `/cart/items`,
`/cart/items/{productId}`) — a caller cannot even address another user's cart. This is
tested directly (`tests/unit/handlers/cart.*.test.ts`, "ignores a client-supplied
userId").

### Pricing: computed at read time, never stored, never trusted

`CartItem` (the stored DynamoDB item) has exactly two meaningful fields:
`productId` and `quantity`. There is no price field to go stale or to spoof. Every read
— `GET /cart` and the response of every mutation — calls `hydrate()`, which re-fetches
each line's `Product` and computes `lineTotalCents = priceCents * quantity` and
`subtotalCents = sum(lineTotalCents)` from that fresh read. A price change takes effect
on the next cart view with no cart write required. Nothing in `addCartItemBodySchema` /
`updateCartItemBodySchema` accepts a price or a subtotal from the client.

### Two distinct races, two distinct DynamoDB conditions

**Race 1 — two requests add to the same cart concurrently.**
`CartRepository.updateCart` treats the header's `updatedAt` as an optimistic lock:
every write is conditioned on `attribute_exists(PK) AND updatedAt = :expectedUpdatedAt`
(a `TransactWriteItems` call, so the lock check and the line writes commit atomically).
If two requests both read the cart at version `v1`, whichever's `updateCart` call
reaches DynamoDB first wins and advances the cart to `v2`; the other's conditional check
fails with `ConditionalCheckFailedException`, which the repository turns into
`ConflictError`.

`CartService` wraps the read-check-write sequence of `addItem`, `updateItemQuantity`,
`removeItem`, and `clearCart` in `withRetry()`, a bounded loop (`maxConflictRetries`,
default 5) that catches exactly `ConflictError` and re-runs the whole operation — not
just the write — because a stale read is the actual problem: resubmitting the same
stale write would just fail the same way again. Each retry re-reads the cart and
re-validates inventory against the fresh state, so a request that started by wanting "3
more units" ends up correctly computing "3 more, on top of what's there now" rather than
clobbering a concurrent addition. Only `ConflictError` is retried: a deterministic
rejection (product not found, product not `ACTIVE`, quantity exceeds inventory) is never
retried, since re-running it would reproduce the identical outcome — see
`tests/unit/services/cart.service.test.ts`, "optimistic-concurrency retry", and the
"retries exhausted" case, which asserts the loop is bounded, not infinite.

**Race 2 — two requests are each a user's first mutation, and the cart header does not
exist yet.** Both see no header, and both call `CartRepository.createCart`, which is
guarded by `attribute_not_exists(PK) AND attribute_not_exists(SK)`. The winner creates
the header; the loser's `ConflictError` here does not mean failure — it means "the
header now exists," which is exactly the outcome the loser wanted. `CartService.
ensureCart()` catches that specific `ConflictError` and re-reads the (now-existing)
cart instead of propagating an error. This is a distinct, smaller race from Race 1 and
is handled inline, without spending a `withRetry` attempt on it.

`tests/integration/cart.concurrency.test.ts` exercises both races end-to-end against
an in-memory model of these exact conditional semantics (`tests/integration/helpers/
in-memory-repositories.ts`), with a real `await` yield between each "read" and "commit"
step so two `Promise.all`-started calls genuinely interleave rather than happening to
run sequentially — including a case where two concurrent adds would jointly exceed
available stock, and only one of the two is admitted.

### Inventory checks are a soft, advisory gate — not a reservation

Adding or updating a cart line performs a strongly consistent read of
`InventoryRepository.getInventory(productId, { consistentRead: true })` and rejects the
write with `InventoryUnavailableError` (409 `INVENTORY_UNAVAILABLE`) if the resulting
cart quantity would exceed `availableQuantity`. This is a real check against the latest
committed stock count, but it is deliberately *not* a reservation: nothing decrements
`availableQuantity` or increments `reservedQuantity` when an item is added to a cart.

This is an explicit trade-off, consistent with `docs/database.md`'s existing
"Consistency Rules": items sitting in a cart do not lock stock away from other shoppers,
so the check-then-add sequence here has an inherent (and accepted) TOCTOU window between
the inventory read and the cart write — a small amount of overselling *into carts* is
possible if two users race to add the last few units. It is not possible to oversell
*orders*, because checkout (a separate, not-yet-implemented flow per
`docs/database.md`'s "Create order" access pattern) re-reads inventory and performs the
authoritative, stock-decrementing conditional update — the same
`attribute_exists(PK) AND availableQuantity = :expected AND reservedQuantity = :expected`
pattern used by `InventoryRepository.updateInventory` — inside the order transaction.
Cart-time inventory checks exist purely to give the shopper accurate, immediate feedback
("only 3 left"), not to guarantee a reservation.

### Why `PATCH .../items/{productId}` and `DELETE .../items/{productId}` 404 on a missing line

`updateItemQuantity` and `removeItem` require the line to already exist and raise
`NotFoundError` otherwise, rather than silently creating it (that is what
`POST /cart/items` is for) or silently no-op'ing. `DELETE /cart` (clear the whole cart)
is the one intentionally idempotent mutation: clearing a cart that does not exist, or is
already empty, is defined as a success with no write, because "the cart has no items" is
already true and there is nothing destructive about confirming that twice.

## Upload Consistency And Security

Product image uploads (`POST /api/v1/uploads/presigned-url` —
`backend/src/handlers/uploads/create-presigned-url.ts`,
`backend/src/services/upload.service.ts`, `backend/src/lib/s3.ts`) never send image
bytes through the Lambda. This section documents exactly what the presigned-URL design
does and does not guarantee, since a couple of those guarantees are easy to assume
incorrectly.

### Browser upload flow

```text
1. Admin's browser -> POST /api/v1/uploads/presigned-url { contentType, contentLength }
                       (API Gateway JWT authorizer verifies the caller; requireAdmin()
                       checks Cognito group membership)
2. Lambda -> validates contentType against an allowlist and contentLength against
             MAX_UPLOAD_BYTES, generates a random object key, asks S3 to presign a PUT
             for that exact bucket/key (no image data touches the Lambda)
3. Lambda -> browser: { key, uploadUrl, method: "PUT", headers, expiresInSeconds }
4. Browser -> PUT <uploadUrl>  (direct to S3, with the image bytes as the request body;
                                 the API and Lambda are no longer involved)
5. S3 -> stores the object at the pre-generated key, privately, if the signature,
         object size, and expiry are all valid
6. (Separate, not-yet-implemented step) Admin's browser -> attaches the returned `key`
   to a product via a future POST /api/v1/products/{id}/images — never a raw URL.
```

The bucket (`ProductImagesBucket` in `serverless.yml`) stays private throughout:
`PublicAccessBlockConfiguration` blocks all public access and
`OwnershipControls: BucketOwnerEnforced` disables bucket ACLs entirely. Nothing in this
flow, or anywhere else in the codebase, grants public read — a stored image is only
ever reachable through infrastructure not yet built (e.g. CloudFront with
origin access control), which is an explicit, separate decision left for later per
`docs/architecture.md`.

### Object key generation: random, never client-influenced

`generateObjectKey()` (`lib/s3.ts`) always produces `products/{randomUUID()}.{ext}`,
where `{ext}` comes from a fixed `AllowedImageContentType -> extension` map
(`domain/upload.ts`), never from anything the client sent. The request schema
(`schemas/upload.schema.ts`) does not even have a `fileName` field — there is no input
for a path-traversal or injection attempt (`../../etc/passwd`, a null byte, an
unexpected extension) to ride in on, because no client-provided string ever becomes
part of the key.

This is also how "never accept arbitrary public URLs as product images" is enforced
structurally: the API only ever hands out keys *it* generated for a bucket *it* owns.
There is no request shape anywhere that accepts an external image URL as a stand-in
for an upload, so a caller cannot get the catalog to reference attacker-controlled
content by supplying one.

### What the presigned URL genuinely enforces, and what it does not

A presigned PUT URL is a SigV4 signature over a specific HTTP request. What it signs
*does* constrain the eventual request:

- **Bucket and key are fixed.** The signature covers the request path, so the upload
  cannot be redirected to a different object or bucket without invalidating it.
- **Expiry is enforced.** `X-Amz-Expires` is part of the signed request; S3 rejects the
  URL once `UPLOAD_URL_EXPIRES_SECONDS` (default 300) has elapsed.

Two properties that look like they should be signature-enforced are not, and are
enforced elsewhere instead:

- **Object size.** A presigned PUT cannot embed a size limit in its own signature —
  that is a presigned-*POST*-policy feature (`content-length-range` conditions), not
  available for a PUT URL. Instead, the `ProductImageObjectWrite` IAM statement in
  `serverless.yml` carries a `NumericLessThanEquals: { s3:RequestObjectSize:
  <MAX_UPLOAD_BYTES> }` condition. S3 evaluates this against the *actual* uploaded byte
  count at PUT time, for the signing role's credentials embedded in the URL — so it is
  enforced regardless of what `contentLength` the client declared when requesting the
  URL. `UploadService.createPresignedUpload` also rejects an over-limit `contentLength`
  up front (`ValidationError`, mapped to 400), purely so an obviously-oversized request
  fails fast with a clear message instead of a confusing S3-level `AccessDenied` after
  the browser has already started uploading.
- **Content-Type.** This is a genuine, documented limitation of presigned PUT, not an
  oversight: `@aws-sdk/s3-request-presigner`'s `S3RequestPresigner` unconditionally adds
  `content-type` to its unsignable-headers set for every S3 presigned URL it produces.
  Setting `ContentType` on the `PutObjectCommand` used to build the URL therefore does
  *not* constrain what `Content-Type` header the actual PUT request carries — the same
  signed URL is valid no matter what content type accompanies the upload, or none at
  all. This is asserted directly in `tests/unit/lib/s3.test.ts`, not just described
  here. The mitigation is layered rather than cryptographic: the API only ever
  generates a URL for one of the three allowlisted image types in the first place
  (`schemas/upload.schema.ts`), and the object's key extension reflects the content
  type the admin *declared* wanting to upload. The residual gap — a client could still
  PUT bytes of a different actual type than declared — is a known, accepted limitation
  of this endpoint alone; closing it fully requires the not-yet-implemented "attach
  image to product" step to independently verify the *stored* object (e.g. a `HeadObject`
  content-type check, or inspecting the file's magic bytes) before accepting it, rather
  than trusting the upload request's declared type. That verification is out of scope
  for this presigned-URL endpoint and is called out here so it isn't silently assumed
  to already be handled.

### Why the Lambda never sees the image bytes

Routing the image through the Lambda (`API Gateway -> Lambda -> S3`) would mean paying
for Lambda compute and API Gateway payload transfer on every megabyte of every image,
would hit API Gateway's request body size limits well before 5 MB of headroom is
useful, and would require the Lambda to buffer the whole file in memory. The
presigned-URL pattern keeps the Lambda's job to exactly what needs a trusted
decision-maker — "is this caller an admin, is this content type allowed, is this size
allowed, here is a one-time place to put it" — and lets the browser talk to S3
directly for the actual transfer.

## Cursor-Based Pagination

Collection endpoints should use DynamoDB `LastEvaluatedKey` as the source for pagination cursors.

Cursor rules:

- Cursor values must be opaque to clients.
- Encode the DynamoDB exclusive start key as URL-safe base64 JSON.
- Validate cursor shape before using it.
- Do not expose raw partition strategy as public API contract.
- Enforce server-side maximum limits.

Implemented in `backend/src/lib/dynamodb.ts` as `encodeCursor`/`decodeCursor`. `decodeCursor`
validates the decoded shape: it must be a non-empty object whose keys are all table or index
key attributes and whose values are all strings, so a tampered cursor cannot inject arbitrary
attributes into a query. Product listing limits are clamped server-side to `MAX_PAGE_LIMIT`
(default 100) and default to `DEFAULT_PAGE_LIMIT` (default 20).

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

## IAM: Per-Function Least Privilege

Every Lambda function in `serverless.yml` carries an explicit `role:` pointing at one
of three purpose-built `AWS::IAM::Role` resources, instead of every function sharing
one `provider.iam.role.statements` block sized for the most privileged handler in the
service (the original design — see PRODUCTION_READINESS.md, "IAM", for the audit that
changed this). Under that shared-role design, a compromised *public, unauthenticated*
handler like `productsGet` ran with permission to `PutItem`/`UpdateItem`/`DeleteItem`
on the entire table, because the role had to cover every function's needs at once.

The three roles, and which functions get each:

- **`PublicReadExecutionRole`** — `dynamodb:GetItem`/`Query`/`DescribeTable` on the
  table, plus `Query` on `GSI1`. No write action of any kind. Used by `productsList`,
  `productsGet`, `productsGetInventory` — the only unauthenticated routes in the API.
- **`CustomerCartExecutionRole`** — `dynamodb:GetItem`/`PutItem`/`Query`/
  `TransactWriteItems` on the table only (no GSI1, no S3, no `DeleteItem`). Used by
  `cartGet`, `cartAddItem`, `cartUpdateItem`, `cartRemoveItem`, `cartClear`. Cart writes
  never issue a raw `DeleteItem` — line removal goes through `TransactWriteCommand`'s
  `Delete` action inside a transaction, which the `TransactWriteItems` API action alone
  covers — see `repositories/cart.repository.ts`.
- **`AdminWriteExecutionRole`** — full table read/write (`GetItem`/`PutItem`/
  `UpdateItem`/`Query`/`DescribeTable`, plus `Query` on `GSI1`) and S3
  `PutObject`/`GetObject`/`AbortMultipartUpload`/`GetBucketLocation` on
  `ProductImagesBucket`'s `products/*` prefix (with the same `s3:RequestObjectSize`
  condition as before — see "Upload Consistency And Security" above). Used by every
  admin-only handler: `productsCreate`, `productsUpdate`, `productsDelete`,
  `productsAdminList`, `adminInventoryGet`, `adminInventoryUpdate`,
  `uploadsCreatePresignedUrl`.

`health` intentionally has no `role:` override — it touches no AWS resource, so the
bare default role Serverless Framework generates (just the `AWSLambdaBasicExecutionRole`
managed policy, for CloudWatch Logs) is already least-privilege for it.

Two actions that existed in the old shared role were dropped entirely rather than
assigned to any role: `dynamodb:BatchGetItem` and `dynamodb:ConditionCheckItem`. Neither
`BatchGetCommand` nor a `ConditionCheck`-typed transact item is issued anywhere in the
codebase (verified by grep, not assumed) — granting them was pure unused surface area.
`dynamodb:DeleteItem` was also dropped: `ProductRepository.delete()` (a hard-delete
method) exists on the repository interface and is exercised by its unit tests, but no
handler calls it — every product removal goes through `deactivate()` (an `UpdateCommand`
soft delete). If a hard-delete endpoint is ever added, `AdminWriteExecutionRole` needs
`dynamodb:DeleteItem` added back deliberately at that point.

`tests/unit/infra/serverless-config.test.ts` parses `serverless.yml` directly (not a
copy) and asserts every function except `health` has an explicit, known `role:`, so
a new function added later without one fails a test instead of silently inheriting
whatever the default happens to be.

## Idempotency

Every mutation in this API except two is naturally idempotent by construction, so no
special handling was needed:

- `PUT /api/v1/products/{id}` and `PUT /api/v1/admin/inventory/{id}` set an *absolute*
  state — replaying the same request twice produces the same end state both times.
- `DELETE /api/v1/products/{id}` (soft delete) and `DELETE /api/v1/cart` /
  `DELETE /api/v1/cart/items/{productId}` are no-ops the second time (already-archived,
  already-empty, already-removed) — see the relevant service methods.
- `PATCH /api/v1/cart/items/{productId}` sets an absolute quantity, same as the `PUT`
  cases above.

Two endpoints are genuinely **not** naturally idempotent, because they create a new
side effect from otherwise-identical input:

- `POST /api/v1/cart/items` — a retried "add to cart" (client timeout, a double-tapped
  button, a flaky mobile network) would add the quantity a second time, silently
  doubling it.
- `POST /api/v1/products` — `productId` is server-generated (`randomUUID()`); a retried
  create would mint a *different* id each time and create two separate products, with
  nothing to conflict on. (The conditional `PutItem` in `ProductRepository.create` only
  guards against the same id being reused, which never happens naturally between two
  independent calls to `randomUUID()`.)

`middleware/idempotency.ts` covers both, via an optional `Idempotency-Key` request
header (client-chosen, a UUID is the usual choice, opaque to the server). First sight
of a key runs the handler normally and caches the complete response (status, headers,
body) keyed by `{namespace}#{callerUserId}#{key}`; a repeat within the TTL window (24h
default) replays that exact cached response instead of re-running the handler. Records
live in the same table (`PK = IDEMPOTENCY#{scopeKey}, SK = RECORD`) with a `ttl`
attribute so DynamoDB expires them automatically — see `CartFlowTable`'s
`TimeToLiveSpecification` in `serverless.yml` and `repositories/idempotency.repository.ts`.

Two implementation details worth knowing if you touch this middleware:

- **Registration order is load-bearing.** It must be `.use()`d *before* `httpCors()` in
  the Middy chain. Middy (v5) skips every `after` middleware — not just later-registered
  ones — for a request a `before` hook short-circuits by setting `response` (confirmed
  by reading `@middy/core`'s `runRequest`, not assumed from the docs). A cached replay
  is exactly that kind of short-circuit, so unless idempotency runs first (making its
  own `after`, which persists the record, run *last* — after `httpCors`'s `after` has
  already added the CORS header on the original request), a replayed response would
  silently come back without `Access-Control-Allow-Origin` and break real cross-origin
  retries. `tests/unit/middleware/idempotency.test.ts` has a regression test for exactly
  this.
- **Only successful (2xx) responses are cached.** An error — including a transient
  500 — is never remembered against the key, so a client that legitimately failed and
  retries isn't permanently stuck replaying that failure.
- **This dedupes sequential retries, not concurrent duplicates.** Two requests carrying
  the same key that arrive genuinely at the same instant can both pass the cache-miss
  check before either has saved a record, and both will execute. Closing that gap fully
  would need a claim/lock step before the handler runs (e.g. a conditional "pending"
  write consumed by the loser), which this intentionally doesn't add — the goal here is
  retry-safety for the overwhelmingly common case (a client that timed out and tried
  again), not a distributed lock.

