import { requireAdmin } from '../../../src/middleware/admin';
import { resetEnvConfig } from '../../../src/config/env';
import { ForbiddenError, UnauthorizedError } from '../../../src/errors/app-error';
import { buildEvent } from '../helpers/fake-event';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv, CARTFLOW_TABLE_NAME: 'cartflow-test', ADMIN_GROUP_NAME: 'admin' };
  resetEnvConfig();
});

afterAll(() => {
  process.env = originalEnv;
  resetEnvConfig();
});

async function runBefore(event: ReturnType<typeof buildEvent>) {
  const middleware = requireAdmin();
  await middleware.before?.({ event, context: {} } as never);
  return event;
}

describe('requireAdmin', () => {
  it('rejects an unauthenticated request with 401, not 403', async () => {
    await expect(runBefore(buildEvent())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an authenticated customer (no admin group membership) with 403', async () => {
    const event = buildEvent({ claims: { sub: 'user-1', 'cognito:groups': '["customer"]' } });
    await expect(runBefore(event)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects an authenticated caller with no groups at all', async () => {
    const event = buildEvent({ claims: { sub: 'user-1' } });
    await expect(runBefore(event)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows an admin caller through and attaches auth context', async () => {
    const event = buildEvent({ claims: { sub: 'admin-1', 'cognito:groups': '["admin"]' } });
    const result = await runBefore(event);
    expect(result.auth).toEqual({ userId: 'admin-1', groups: ['admin'] });
  });

  it('allows a caller who belongs to admin among several groups', async () => {
    const event = buildEvent({
      claims: { sub: 'admin-1', 'cognito:groups': '["customer","admin"]' },
    });
    const result = await runBefore(event);
    expect(result.auth?.groups).toContain('admin');
  });

  it('honours a non-default ADMIN_GROUP_NAME from configuration', async () => {
    process.env.ADMIN_GROUP_NAME = 'staff';
    resetEnvConfig();
    const event = buildEvent({ claims: { sub: 'user-1', 'cognito:groups': '["staff"]' } });
    const result = await runBefore(event);
    expect(result.auth?.groups).toContain('staff');
  });

  it('does not grant admin access under the old group name once ADMIN_GROUP_NAME changes', async () => {
    process.env.ADMIN_GROUP_NAME = 'staff';
    resetEnvConfig();
    const event = buildEvent({ claims: { sub: 'user-1', 'cognito:groups': '["admin"]' } });
    await expect(runBefore(event)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('never derives identity from a client-supplied field', async () => {
    const event = buildEvent({
      claims: { sub: 'admin-1', 'cognito:groups': '["admin"]' },
      body: { userId: 'attacker-supplied-id', role: 'admin' },
    });
    const result = await runBefore(event);
    expect(result.auth?.userId).toBe('admin-1');
  });
});
