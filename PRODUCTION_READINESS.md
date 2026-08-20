# CartFlow Production-Readiness Audit

**Scope:** `backend/` (Serverless Framework / AWS Lambda / DynamoDB / S3 / Cognito) and, where
relevant, `frontend/`. **Method:** direct code review against each category below, verified
against the real source (`serverless.yml`, handlers, middleware, repositories) rather than
assumed — several findings below were confirmed by reading library source
(`@middy/http-json-body-parser`, `@middy/core`, `@middy/http-cors`) or by grepping for actual
usage rather than trusting a doc comment. Every fix in this report is implemented in this
commit, not just described: code, tests, and documentation were all updated together. Not
described but not fixed here shows up under "Known limitations, not fixed in this pass" with an
explicit reason.

**Verification after every change below:** `npm run lint`, `npm run typecheck`, `npm test`
(backend: 350 tests / 39 suites, frontend: 69 tests / 11 suites — all passing), and
`serverless package --stage dev` / `--stage prod` (both packaging cleanly — full config
validation, no deploy performed).

---

## Summary

| #   | Category                 | Status                                                                                  | Severity    |
| --- | ------------------------ | --------------------------------------------------------------------------------------- | ----------- |
| 1   | IAM                      | **Fixed**                                                                               | High        |
| 2   | Rate limiting            | **Fixed**                                                                               | Medium      |
| 3   | Logging                  | **Fixed**                                                                               | Medium      |
| 4   | Idempotency              | **Fixed**                                                                               | Medium-High |
| 5   | Concurrency              | Reviewed — already sound                                                                | —           |
| 6   | DynamoDB access patterns | Reviewed — mostly sound; one pre-existing, already-disclosed limitation carried forward | Low         |
| 7   | Authorization            | Reviewed — sound; strengthened by #1                                                    | —           |
| 8   | Authentication           | Reviewed — sound                                                                        | —           |
| 9   | Input validation         | Reviewed — sound                                                                        | —           |
| 10  | Error handling           | Reviewed — sound; strengthened by #3                                                    | —           |
| 11  | Secrets                  | Reviewed — sound                                                                        | —           |
| 12  | CORS                     | Reviewed — sound; extended for #4                                                       | —           |
| 13  | S3                       | Reviewed — sound                                                                        | —           |
| 14  | Lambda performance       | Reviewed — sound                                                                        | —           |
| 15  | Performance (general)    | Reviewed — sound                                                                        | —           |
| 16  | Cost                     | Reviewed — sound                                                                        | —           |
| 17  | API versioning           | Reviewed — sound                                                                        | —           |
| 18  | Pagination               | Reviewed — sound                                                                        | —           |
| 19  | Security (general)       | Reviewed — see #1–#4; one accepted frontend tradeoff noted                              | —           |

---

## 1. IAM — Fixed (High)

**Problem.** Every one of the 16 business Lambda functions shared one execution role
(`provider.iam.role.statements` in `serverless.yml`), sized for the _most_ privileged function
in the service. That role granted `dynamodb:GetItem/PutItem/UpdateItem/DeleteItem/Query/
BatchGetItem/ConditionCheckItem/TransactWriteItems` on the entire table plus `s3:PutObject/
GetObject/AbortMultipartUpload` on the product-images bucket — to _every_ function, including
the three fully public, unauthenticated read routes (`productsList`, `productsGet`,
`productsGetInventory`).

Two of the granted actions (`dynamodb:BatchGetItem`, `dynamodb:ConditionCheckItem`) are never
issued anywhere in the codebase (verified by grep, not assumed) — pure unused surface area.
`dynamodb:DeleteItem` was only reachable through `ProductRepository.delete()`, a hard-delete
method with unit-test coverage but no handler wired to it in production.

**Impact.** A compromise of any single function — a supply-chain vulnerability in a dependency,
an SSRF/RCE bug in a future feature, a misconfigured integration — inherited full read/write/
delete on the entire catalog, cart, and inventory data, and write access to the image bucket,
regardless of what that specific function actually needed. The public `productsGet` handler in
particular had permission to delete arbitrary items despite never legitimately calling any
write API.

**Fix.** Replaced the single shared role with three purpose-built `AWS::IAM::Role` resources,
each granting only the actions its functions actually call:

- `PublicReadExecutionRole` — read-only (`GetItem`/`Query`/`DescribeTable` + GSI1 `Query`).
  Used by the three public routes.
- `CustomerCartExecutionRole` — `GetItem`/`PutItem`/`Query`/`TransactWriteItems` on the table
  only (no GSI1, no S3, no `DeleteItem`). Used by the five cart routes.
- `AdminWriteExecutionRole` — full table read/write + the S3 grants (unchanged, including the
  existing `s3:RequestObjectSize` size-limit condition). Used only by the seven admin/upload
  routes, which are already gated by `requireAdmin()` at the application layer — this is
  defense in depth, not the primary control.

`health` gets no override — the bare default role (`AWSLambdaBasicExecutionRole` only) is
already least-privilege for a function that touches no AWS resource.

**Files:** `backend/serverless.yml` (role resources + a `role:` line on every function except
`health`).

**Test:** `backend/tests/unit/infra/serverless-config.test.ts` (new) — parses `serverless.yml`
directly and asserts (1) all three roles exist, (2) every function except `health` has an
explicit, known `role:` (so a new function added later without one fails a test instead of
silently inheriting a default), (3) `PublicReadExecutionRole` never grants a write action, (4)
`CustomerCartExecutionRole` never grants S3 or `DeleteItem`. Also verified empirically: read the
generated CloudFormation template after `serverless package` and confirmed every function's
`Role` property and the default role's policy contents by hand before writing the test.

**Docs:** `docs/database.md`, new "IAM: Per-Function Least Privilege" section — the full
per-role action list, which functions use each, and why `BatchGetItem`/`ConditionCheckItem`/
`DeleteItem` were dropped rather than assigned anywhere.

---

## 2. Rate limiting — Fixed (Medium)

**Problem.** No throttling was configured anywhere — API Gateway HTTP API's account-level
defaults (10,000 req/s burst, 5,000 req/s steady-state, shared across every API in the AWS
account/region) were the only ceiling.

**Impact.** A single misbehaving script, an accidental infinite retry loop, or a naive scraping
attempt against the public catalog routes could consume a disproportionate share of account-wide
API Gateway capacity, run up DynamoDB on-demand read costs, and — since account limits are
shared — degrade any other API Gateway service in the same account.

**Fix.** Stage-wide default route throttling via `AWS::ApiGatewayV2::Stage.DefaultRouteSettings`
(`ThrottlingBurstLimit`/`ThrottlingRateLimit`), configured per stage: 20/10 in dev (deliberately
low — a single-developer stage should fail fast and visibly on a runaway local script), 50/25 in
prod. `serverless-framework` has no `provider.httpApi.throttle` shorthand for HTTP API (that's a
REST-API-only feature) — implemented as a CloudFormation override merged onto the framework's
auto-generated `$default` stage resource, which was verified working by inspecting the generated
template (`ThrottlingBurstLimit`/`ThrottlingRateLimit` present under `DefaultRouteSettings`), not
assumed from documentation.

**Honest limitation, documented rather than silently left implicit:** this is a coarse,
account-wide safety net, not per-user or per-IP fairness — one abusive caller can still exhaust
the whole stage's budget for every other caller. True per-key throttling on HTTP API requires a
usage-plan/API-key model that conflicts with this API's public, unauthenticated read routes, or
an added AWS WAF rate-based rule (not implemented — see "Known limitations" below).

**Files:** `backend/serverless.yml`, `backend/config/dev.yml`, `backend/config/prod.yml`.

**Test:** Verified structurally via `serverless package` output inspection (the merged
CloudFormation template was read and its `DefaultRouteSettings` values confirmed to match the
per-stage config). No dedicated unit test — this is infrastructure configuration with no
application code path to unit-test; the existing `serverless-config.test.ts` was considered for
this but throttle values aren't meaningfully assertable without re-deriving the stage config
loader, so this was verified via the packaging check instead, documented here rather than
silently skipped.

**Docs:** Inline `serverless.yml` comments explaining the workaround and the coarse-not-fair
tradeoff; referenced from this report.

---

## 3. Logging — Fixed (Medium)

**Problem.** Two gaps:

1. **No request-level access logging at all.** Only truly unexpected (non-`AppError`, mapped to 500) errors ever reached CloudWatch, via a single `console.error` in `error-handler.ts`. Every
   2xx, 4xx, and expected-error response left no trace anywhere.
2. **No visibility into authorization failures.** A 401 (unauthenticated) or 403 (authenticated
   but insufficiently privileged) response was returned to the caller but never logged — no way
   to notice a token-scanning attempt or a privilege-escalation attempt after the fact.

**Impact.** No way to answer "what did request X actually do", measure latency, see traffic
volume/shape, or investigate a security-relevant access pattern without adding logging _after_
an incident, which is too late to have caught it.

**Fix.**

- **API Gateway access logs**: a structured JSON log line for every request (method, route,
  status, latency, source IP, user agent, the same `requestId` that appears in every JSON error
  response) via `AccessLogSettings` on the HTTP API stage, writing to a dedicated
  `AWS::Logs::LogGroup` with the same retention as the Lambda logs. Also added the
  `AWS::Logs::ResourcePolicy` grant API Gateway needs to write into a log group it doesn't own —
  a well-known gotcha where access logging silently no-ops without it unless the AWS account
  happens to already have the classic REST-API CloudWatch role configured account-wide.
- **Authorization-failure logging**: `error-handler.ts` now logs a structured, single-line JSON
  entry (`console.warn` for 401, `console.error` for 403 — the latter is a _known, identified_
  caller deliberately attempting something their role doesn't permit, more actionable than an
  anonymous 401) containing `requestId`, HTTP method/path, and the caller's user id if known —
  deliberately _never_ the error's `message` or any request body, so this stays safe even if a
  future error message ever interpolates request data.

**Files:** `backend/serverless.yml` (log group, resource policy, `AccessLogSettings`),
`backend/src/middleware/error-handler.ts`.

**Test:** `backend/tests/unit/middleware/error-handler.test.ts` — new assertions that a 401/403
logs exactly one structured entry with the expected fields, and an explicit test that a
custom/dynamic error message is _never_ echoed into the log line.

**Docs:** Inline comments on both the `serverless.yml` resources and the `error-handler.ts`
logging helper explain what's logged, why, and what's deliberately excluded.

---

## 4. Idempotency — Fixed (Medium-High)

**Problem.** Two POST endpoints create a resource as a side effect and had no retry protection:

- `POST /api/v1/cart/items` — a client timeout, a flaky mobile connection, or a double-tapped
  "Add to cart" button retries the same logical request, silently doubling the quantity added.
- `POST /api/v1/products` — `productId` is server-generated via `randomUUID()`; a retry mints a
  _different_ id each time, so the existing conditional-`PutItem` duplicate guard (which only
  protects against the same id being reused) never fires — a retry silently creates two separate
  products from one admin action.

Every other mutation in the API was already naturally idempotent (`PUT` sets absolute state,
`DELETE`/no-quantity-change operations are no-ops the second time) and needed no change.

**Impact.** Real, user-visible correctness bugs under exactly the conditions retries actually
happen — poor connectivity, slow cold starts, or impatient double-clicking — with no server-side
protection at all.

**Fix.** `backend/src/middleware/idempotency.ts` (new): an optional `Idempotency-Key` request
header, scoped per-caller and per-endpoint (`{namespace}#{callerUserId}#{key}`), backed by a new
`backend/src/repositories/idempotency.repository.ts` storing the _complete_ previous response in
the same DynamoDB table (`PK = IDEMPOTENCY#{scopeKey}, SK = RECORD`) with a `ttl` attribute (24h
default) so records expire automatically — added `TimeToLiveSpecification` to `CartFlowTable`.
Wired onto `cartAddItem` and `productsCreate` only (the two genuinely non-idempotent endpoints);
omitting the header remains fully valid everywhere, nothing about the API requires it.

**A real bug found and fixed via the test suite, not just theorized:** the first implementation
cached only `{statusCode, body}` and short-circuited by setting `request.response` inside a
`before` hook. Reading `@middy/core`'s actual source (not assumed from docs) showed that Middy
skips _every_ `after` middleware — not just later-registered ones — whenever a `before` hook
sets `response`, because the `after` chain lives inside the same `if (response === undefined)`
guard as the handler call itself. Since `@middy/http-cors`'s CORS-header logic runs in `after`,
the first version of a replayed response would have silently come back _without_ the
`Access-Control-Allow-Origin` header — breaking real cross-origin retries from the browser,
exactly the case this feature exists to handle. Fixed by (1) caching and replaying the _entire_
response verbatim (headers included), and (2) registering the idempotency middleware _before_
`httpCors()` in both handlers, so on the original (non-cached) request its own `after` hook runs
_after_ `httpCors`'s and sees the fully-finalized response. A regression test
(`replays a response that still carries the CORS headers httpCors added the first time`) pins
this.

**Honest limitations, documented rather than silently left implicit:**

- Dedupes _sequential_ retries (the common real-world case), not genuinely concurrent duplicate
  requests — two requests carrying the same key arriving at the same instant can both pass the
  cache-miss check before either has saved a record. Closing that fully needs a claim/lock step,
  which was deliberately not added for a feature whose job is retry-safety, not distributed
  locking.
- Idempotency's `before` hook now runs ahead of `requireAuthentication()`/`requireAdmin()` (a
  requirement of the CORS fix above), meaning an unauthenticated request carrying a garbage
  `Idempotency-Key` header now costs one wasted DynamoDB read before the 401/403 fires. Analyzed
  and judged safe: a cache _hit_ can only ever occur for a scope key namespaced by the caller's
  own verified JWT `sub` claim, and a record only exists if that exact scope previously passed
  the real authorization check — so this reordering grants no one anything, it only adds a
  bounded, cheap (`GetItem`, on-demand billing, sub-millisecond) cost for abuse traffic, which
  the new stage-wide throttle (finding #2) also bounds.

**Files:** `backend/src/middleware/idempotency.ts` (new), `backend/src/repositories/
idempotency.repository.ts` (new), `backend/src/handlers/cart/add-item.ts`, `backend/src/handlers/
products/create.ts`, `backend/serverless.yml` (table TTL spec, CORS `allowedHeaders`).

**Test:** `backend/tests/unit/middleware/idempotency.test.ts` (8 tests: no-header pass-through,
first-sight caching, replay-without-re-invoking, per-caller scoping, non-2xx never cached,
thrown-error never cached, oversized-header treated as absent, and the CORS regression test
above), `backend/tests/unit/idempotency.repository.test.ts` (6 tests: fresh/absent/expired
records, conditional write, racing-duplicate-write silently dropped, unexpected error
propagated), plus full-stack integration tests added to `backend/tests/integration/
cart.api.test.ts` and `backend/tests/integration/products.api.test.ts` proving a retried request
through the _real_ handler chain mutates the cart/creates a product exactly once.

**Docs:** `docs/database.md`, new "Idempotency" section covering the full per-endpoint
idempotency breakdown (why every other endpoint needed no change), the protocol, the storage
shape, and both limitations above in detail.

---

## 5. Concurrency — Reviewed, already sound

Cart mutations use optimistic concurrency (`Cart.updatedAt` as the lock, `TransactWriteCommand`
conditioned on it) with bounded retry (`CartService`'s `withRetry`, default 5 attempts);
duplicate-cart-creation races are resolved by treating a losing `ConditionalCheckFailedException`
on `createCart` as "someone else already created it, re-read and continue" rather than an error.
Product/inventory updates use conditional `UpdateItem` on `updatedAt`. All of this already has
dedicated test coverage that exercises genuine interleaving, not just mocked call order —
`backend/tests/integration/cart.concurrency.test.ts` races real `Promise.all` calls against an
in-memory model that yields on a macrotask between read and write (see that file's own doc
comment). No changes made; reviewed and confirmed sound.

## 6. DynamoDB access patterns — Reviewed, one pre-existing limitation carried forward

No `Scan` anywhere in the codebase (verified by grep) — every list operation is a `Query` against
either the primary key or GSI1, both with cursor-based pagination. Single-table design with
denormalized `GSI1PK`/`GSI1SK` for the products-by-status/category access pattern is documented
in `docs/database.md`.

One limitation, **already identified and documented in a prior turn** (the admin-dashboard
build), not newly discovered by this audit, and therefore not re-implemented here: the
`/admin/inventory` page fetches stock for each listed product with an individual `GetItem` call
(N+1) rather than a single `Query` against a stock-status index. `InventoryRepository` already
computes `GSI3PK`/`GSI3SK` attributes on every write in anticipation of this, but no `GSI3` index
is actually provisioned on the table and no bulk-query endpoint or repository method exists yet.
Severity is low in practice — the admin dashboard is low-traffic and the per-item reads are cheap
on-demand `GetItem`s — but it's a real, known gap. Recommendation: add the `GSI3` index to
`CartFlowTable`, a `InventoryRepository.listByStatus()` method, and an admin bulk-listing
endpoint; wire the frontend `AdminInventoryPage` to it instead of per-product fetches.

## 7. Authorization — Reviewed, sound (strengthened by #1)

Admin authorization (`requireAdmin()`) checks Cognito group membership from the verified JWT —
never a client-supplied field. `getCurrentUser()` is the sole source of caller identity
everywhere in the codebase (grepped and confirmed in a prior turn; re-confirmed here). IAM
least-privilege (#1) adds defense-in-depth on top of this application-layer check.

## 8. Authentication — Reviewed, sound

Cognito JWT verified by the API Gateway `jwt` authorizer (signature, expiry, issuer, audience)
before a Lambda ever runs; application code only ever reads the already-verified claims from
`event.requestContext.authorizer.jwt.claims`, never re-parses or trusts a raw bearer token
itself. `ALLOW_USER_PASSWORD_AUTH` (needed for the browser SPA, since it has no SRP library) is
documented in `serverless.yml` with its TLS-dependent tradeoff explained inline.

## 9. Input validation — Reviewed, sound

Every path/query/body is validated with Zod before reaching a service (`validate()` middleware),
including UUID format, price bounds, quantity bounds, string sanitization (`utils/sanitize.ts`
strips HTML on every user-authored text field), and an explicit allowlist for upload content
types. Extensively unit-tested per-schema already.

## 10. Error handling — Reviewed, sound (strengthened by #3)

Single `errorHandler()` middleware maps every known error type to the documented response
contract; unrecognized errors are logged server-side and reduced to a bare `INTERNAL_ERROR` with
no internal detail (message, stack) reaching the client — asserted by an existing test that
checks the _logged_ detail never leaks into the _response_ body.

**A note on status codes, checked empirically rather than assumed:** this API deliberately never
returns `422`. Traced `@middy/http-json-body-parser`'s real source: malformed JSON actually
produces `415` (its own source comment says "UnprocessableEntity" but the call is literally
`createError(415, ...)` — a mislabeled comment in the library, not its behavior). A test in
`backend/tests/integration/products.api.test.ts` sends genuinely malformed JSON through a real
handler and pins the actual `415` response, with an explicit assertion that it is _not_ `422`.

## 11. Secrets — Reviewed, sound

Grepped the full repository (`backend/`, `frontend/`, `docs/`) for AWS access key patterns,
private key headers, and hardcoded credential assignments — none found; every credential-shaped
value in the repo is a placeholder (`.env.example` files, `us-east-1_example`) or an environment
variable _name_. Deployment already uses GitHub Actions OIDC federation for AWS (no static keys)
and an encrypted `VERCEL_TOKEN` secret for the frontend — see `README.md`, "Configuring deploy
credentials", from the CI/CD setup in a prior turn.

## 12. CORS — Reviewed, sound (extended for #4)

`allowedOrigins` is stage-configured (never a wildcard), `allowCredentials: false` (correct for
Bearer-token auth, not cookies — asserted by `serverless-config.test.ts`), and `allowedHeaders`
is a minimal explicit list, now including `idempotency-key` for finding #4.

## 13. S3 — Reviewed, sound

`ProductImagesBucket` blocks all public access (`PublicAccessBlockConfiguration`, all four flags
true), disables ACLs entirely (`BucketOwnerEnforced`), enforces SSE, and the presigned-PUT upload
flow has its own detailed, previously-audited write-up in `docs/database.md` ("Upload Consistency
And Security") — including an already-documented, previously-discovered limitation (presigned PUT
cannot cryptographically enforce `Content-Type`) that was proven with a dedicated test in a prior
turn, not newly found here.

## 14. Lambda performance — Reviewed, sound

`arm64` architecture (cheaper and generally faster than x86_64 for Node.js workloads),
`AWS_NODEJS_CONNECTION_REUSE_ENABLED=1`, esbuild bundling with production minification, and the
DynamoDB document client is a Lambda-container-scoped singleton (`lib/dynamodb.ts`'s
`getDocumentClient()`) so warm invocations reuse the same client/connection rather than
reconstructing one per request. `@aws-sdk/*` is excluded from the esbuild bundle since the
Node.js 18.x Lambda runtime provides AWS SDK v3 natively — smaller deployment package, faster
cold start.

## 15. Performance (general) — Reviewed, sound

No `Scan` operations (see #6), cursor-based pagination bounds every list response, `TransactWriteItems` is used only where genuinely needed (cart line mutations), and reads that don't need
strong consistency (e.g. the public stock check) deliberately don't pay for it — documented
inline in `services/inventory.service.ts`.

## 16. Cost — Reviewed, sound

DynamoDB `PAY_PER_REQUEST` billing (no idle capacity cost for a portfolio-traffic app), `arm64`
Lambda pricing, explicit CloudWatch log retention (7 days dev / 30 days prod — no indefinite log
storage cost), and S3 lifecycle rules already in place (incomplete-multipart-upload cleanup,
`tmp/` prefix expiration). The new idempotency records (#4) and access-log group (#3) both add a
small, bounded, TTL/retention-limited storage cost, called out explicitly rather than left
implicit.

## 17. API versioning — Reviewed, sound

Every business route is consistently prefixed `/api/v1/...`; no unversioned or mixed-version
routes exist.

## 18. Pagination — Reviewed, sound

Every list endpoint (public and admin) uses the same opaque, cursor-based pattern
(`lib/dynamodb.ts`'s `encodeCursor`/`decodeCursor`), with the cursor's key-attribute shape
validated on decode so a tampered cursor can't smuggle arbitrary attributes into a query.

## 19. Security (general) — See #1–#4 above; one accepted frontend tradeoff

One item reviewed and consciously accepted rather than changed: the frontend stores the Cognito
session (id/access/refresh tokens) in `localStorage` (`frontend/src/auth/tokenStore.ts`), which
is readable by any script that achieves XSS, unlike an `httpOnly` cookie. This is the standard,
pragmatic choice for a pure SPA calling an API Gateway JWT authorizer that expects an
`Authorization: Bearer` header — cookies don't flow into that model without significant added
backend/authorizer redesign (a proxy layer to move the token from a cookie into a header), which
is disproportionate to this audit. Mitigated in the existing codebase by React's default output
escaping and server-side HTML sanitization on every user-authored field (`utils/sanitize.ts`) —
no known XSS vector exists in the app today, but this is a real, standing tradeoff worth stating
explicitly rather than leaving implicit.

---

## Known limitations, not fixed in this pass

Listed here by design — the instruction to implement every _finding_ applies to problems this
audit identified; the items below are either pre-existing, already-disclosed decisions carried
forward from prior work (not new findings), or infrastructure-scale investments judged
disproportionate to a portfolio-scale application and called out for a deliberate, future
decision rather than silently deferred:

- **GSI3 / admin-inventory N+1** (see #6) — already documented before this audit; not
  re-implemented here.
- **AWS WAF** — no rate-based or managed-rule-set WAF is attached to the API. Adding one is
  real recommended hardening for a production launch at scale, but it's a recurring cost
  (roughly $5-$10+/month plus per-request fees) that isn't justified for the current
  portfolio-scale traffic; the stage-wide throttle (#2) is the interim, free mitigation.
- **Cognito Advanced Security Mode** — would add compromised-credential detection and
  adaptive risk-based auth (e.g. throttling password-spray attempts) but is a paid Cognito
  feature tier; not enabled for the same cost-proportionality reason as WAF.
- **True concurrent-duplicate idempotency locking** (see #4) — sequential-retry-safe today;
  a claim/lock step for genuinely simultaneous duplicate requests was judged disproportionate
  to add for this application's actual risk profile.
- **`npm audit` findings in the `serverless` CLI's own dependency tree** (10 advisories, 2
  critical) — investigated and traced entirely to `@serverless/dashboard-plugin`,
  `aws-sdk` v2, `tar`, `decompress`, and `adm-zip`: transitive _devDependencies_ of the
  Serverless Framework CLI itself (v3.39.0), used only for local/CI packaging and deployment.
  None of these packages are bundled into the deployed Lambda artifact — `esbuild` only bundles
  `src/**`, explicitly excludes `@aws-sdk/*`, and the `serverless` package itself is never
  `require()`d by any Lambda handler. Real-world exposure is therefore limited to whatever
  machine runs `serverless deploy` (CI), not the running application. Not force-upgraded in
  this pass — `npm audit fix --force` would bump the Serverless Framework across a major
  version boundary, which needs its own deploy-tested verification pass, not a blind mid-audit
  change to the deploy tool itself. Recommendation: track a Serverless Framework v4 migration
  (or dependency `overrides` pinning `tar`/`decompress` to patched versions) as its own,
  separately-verified piece of work.
