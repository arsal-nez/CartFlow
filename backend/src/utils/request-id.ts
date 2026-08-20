import { randomUUID } from 'node:crypto';

/**
 * Every response carries a `requestId`. API Gateway HTTP API always supplies
 * `requestContext.requestId`; the fallback only matters for locally invoked
 * handlers or test events that omit it.
 */
export function getRequestId(
  event: { requestContext?: { requestId?: string } } | undefined,
): string {
  const id = event?.requestContext?.requestId;
  return id !== undefined && id.trim() !== '' ? id : randomUUID();
}
