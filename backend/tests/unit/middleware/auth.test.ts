import { getCurrentUser, requireAuthentication } from '../../../src/middleware/auth';
import { UnauthorizedError } from '../../../src/errors/app-error';
import { buildEvent } from '../helpers/fake-event';

async function runBefore(event: ReturnType<typeof buildEvent>) {
  const middleware = requireAuthentication();
  await middleware.before?.({ event, context: {} } as never);
  return event;
}

describe('getCurrentUser', () => {
  it('returns null when no authorizer context is present (public route, no token)', () => {
    expect(getCurrentUser(buildEvent())).toBeNull();
  });

  it('returns null when the sub claim is missing from the token', () => {
    expect(getCurrentUser(buildEvent({ claims: { 'cognito:groups': '["admin"]' } }))).toBeNull();
  });

  it('returns null for a blank sub claim', () => {
    expect(getCurrentUser(buildEvent({ claims: { sub: '   ' } }))).toBeNull();
  });

  it('reads userId from the verified sub claim, never from the request body', () => {
    const event = buildEvent({
      claims: { sub: 'user-1' },
      body: { userId: 'attacker-supplied-id' },
    });
    expect(getCurrentUser(event)).toEqual({ userId: 'user-1', groups: [] });
  });

  it('parses a JSON-array cognito:groups claim (Cognito ID token shape)', () => {
    const user = getCurrentUser(
      buildEvent({ claims: { sub: 'user-1', 'cognito:groups': '["admin"]' } }),
    );
    expect(user).toEqual({ userId: 'user-1', groups: ['admin'] });
  });

  it('parses a comma-separated cognito:groups claim', () => {
    const user = getCurrentUser(
      buildEvent({ claims: { sub: 'user-1', 'cognito:groups': 'admin, customer' } }),
    );
    expect(user).toEqual({ userId: 'user-1', groups: ['admin', 'customer'] });
  });

  it('returns an empty group list — a plain customer — when the claim is absent', () => {
    const user = getCurrentUser(buildEvent({ claims: { sub: 'user-1' } }));
    expect(user).toEqual({ userId: 'user-1', groups: [] });
  });
});

describe('requireAuthentication', () => {
  it('rejects a request with no verified identity', async () => {
    await expect(runBefore(buildEvent())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('allows any authenticated caller through, admin or customer', async () => {
    const event = buildEvent({ claims: { sub: 'user-1' } });
    const result = await runBefore(event);
    expect(result.auth).toEqual({ userId: 'user-1', groups: [] });
  });

  it('attaches the verified identity to event.auth for the handler to read', async () => {
    const event = buildEvent({ claims: { sub: 'user-1', 'cognito:groups': '["admin"]' } });
    const result = await runBefore(event);
    expect(result.auth).toEqual({ userId: 'user-1', groups: ['admin'] });
  });
});
