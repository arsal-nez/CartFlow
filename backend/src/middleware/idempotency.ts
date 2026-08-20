import type { MiddlewareObj } from '@middy/core';

import {
  createIdempotencyRepository,
  type IdempotencyRepository,
} from '../repositories/idempotency.repository';
import type { ApiGatewayEvent, ApiGatewayResult } from '../types/http';
import { getCurrentUser } from './auth';

/**
 * Idempotency-key support for POST endpoints whose retry (a client timeout,
 * a flaky mobile network, a double-tapped button) would otherwise repeat a
 * real side effect — an extra product created, a cart line double-added.
 * Every other mutation in this API is naturally idempotent already: PUT
 * sets an absolute state, DELETE is a no-op the second time (see
 * docs/database.md, "Idempotency" for the full per-endpoint breakdown) —
 * this middleware exists specifically for the POST handlers that aren't.
 *
 * Protocol: an optional `Idempotency-Key` request header, opaque to the
 * server, chosen by the client (a UUID is the usual choice) and reused
 * across retries of what the client considers "the same" request. First
 * sight of a key runs the handler normally and caches its response; a
 * repeat within the TTL window replays that cached response instead of
 * re-running the handler. Omitting the header is always valid — nothing
 * about this API requires it — a request without one just isn't
 * deduplicated.
 *
 * Scoped per-caller (see `scopeKeyFor`) so two different users can't collide
 * on the same client-chosen key string, and per-`namespace` so the same key
 * value reused across two different endpoints doesn't cross-contaminate.
 *
 * Known limitation: this dedupes *sequential* retries (the common real-world
 * case — a client that timed out and tries again). Two requests carrying the
 * same key that arrive genuinely concurrently can both race past the
 * `getRecord` check before either has saved a record, and both will execute
 * — true concurrent-duplicate suppression would need a claim/lock step
 * before the handler runs, which this intentionally doesn't add for a
 * feature whose main job is retry-safety, not a distributed lock.
 *
 * Registration order matters and is non-obvious: Middy (v5) skips *every*
 * `after` middleware — not just later-registered ones — for a request that
 * a `before` hook short-circuits by setting `response` (verified by reading
 * `@middy/core`'s `runRequest`: the `after` chain is inside the same
 * `if (typeof request.response === 'undefined')` block as the handler
 * call). A cached replay is exactly that kind of short-circuit, so it never
 * passes through `@middy/http-cors`'s `after` — meaning a naively-cached
 * `{statusCode, body}` would replay *without* the CORS header a browser
 * needs. Fixed two ways together: (1) this middleware is registered
 * *before* `httpCors()` in every handler that uses it, so on the original
 * (non-replayed) request its own `after` runs *after* `httpCors`'s in the
 * reverse-order `after` chain and sees the fully-finalized response; (2) it
 * caches and replays the *entire* response (headers included), not just
 * status and body.
 */

const HEADER_NAME = 'idempotency-key';
const MAX_KEY_LENGTH = 128;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export interface IdempotencyOptions {
  /** Namespaces the key so two different endpoints never share a cache entry. */
  namespace: string;
  ttlSeconds?: number | undefined;
  repository?: IdempotencyRepository | undefined;
}

function readHeader(event: ApiGatewayEvent): string | undefined {
  // API Gateway HTTP API (payload v2) normalizes header names to lower
  // case, but this reads defensively in case a test or a future proxy
  // layer doesn't.
  return event.headers?.[HEADER_NAME] ?? event.headers?.['Idempotency-Key'];
}

function scopeKeyFor(namespace: string, event: ApiGatewayEvent, key: string): string {
  const caller = getCurrentUser(event);
  return `${namespace}#${caller?.userId ?? 'anonymous'}#${key}`;
}

interface InternalState {
  idempotencyScopeKey?: string;
  idempotencyReplayed?: boolean;
}

export function idempotency(
  options: IdempotencyOptions,
): MiddlewareObj<ApiGatewayEvent, ApiGatewayResult> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  let repository: IdempotencyRepository | undefined = options.repository;
  const getRepository = (): IdempotencyRepository => {
    repository ??= createIdempotencyRepository();
    return repository;
  };

  return {
    before: async (request) => {
      const rawKey = readHeader(request.event);
      if (rawKey === undefined) {
        return;
      }
      const key = rawKey.trim();
      // An empty or absurdly long header is treated the same as "no key" —
      // silently ignored, not a 400. A malformed idempotency key is a hint
      // the client is doing something unusual, not a request the customer
      // should see fail.
      if (key === '' || key.length > MAX_KEY_LENGTH) {
        return;
      }

      const scopeKey = scopeKeyFor(options.namespace, request.event, key);
      const internal = request.internal as InternalState;
      internal.idempotencyScopeKey = scopeKey;

      const cached = await getRepository().getRecord(scopeKey);
      if (cached !== null) {
        internal.idempotencyReplayed = true;
        // The *entire* previously-finalized response, byte for byte —
        // including whatever `httpCors` added — not a hand-reconstructed
        // approximation. See the module doc comment on registration order.
        request.response = JSON.parse(cached.responseJson) as ApiGatewayResult;
      }
    },

    after: async (request) => {
      const internal = request.internal as InternalState;
      if (internal.idempotencyReplayed === true) {
        return; // Served from cache — nothing new to persist.
      }
      const scopeKey = internal.idempotencyScopeKey;
      const response = request.response;
      if (scopeKey === undefined || response === undefined || response === null) {
        return;
      }
      // Only successful responses are cached. An error response (including
      // a 500) is never remembered against the key, so a client that
      // legitimately failed and retries isn't permanently stuck replaying
      // that failure — see the module doc comment.
      const statusCode = response.statusCode;
      if (statusCode === undefined || statusCode < 200 || statusCode >= 300) {
        return;
      }
      await getRepository().saveRecord(
        scopeKey,
        { responseJson: JSON.stringify(response) },
        ttlSeconds,
      );
    },
  };
}
