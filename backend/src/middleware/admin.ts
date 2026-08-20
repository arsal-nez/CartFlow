import type { MiddlewareObj } from '@middy/core';

import { getEnvConfig } from '../config/env';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error';
import type { ApiGatewayEvent, ApiGatewayResult } from '../types/http';
import { getCurrentUser } from './auth';

/**
 * Admin-role authorization, layered on top of `./auth`'s authentication.
 * Membership in the Cognito admin group (`ADMIN_GROUP_NAME`, default
 * `admin`) is the only source of admin privilege — never a client-supplied
 * flag or role field.
 */

/**
 * Middy middleware: requires an authenticated caller (401) who belongs to
 * the configured admin Cognito group (403 otherwise). Attaches the identity
 * to `event.auth`. `ADMIN_GROUP_NAME` is read lazily, inside `before`, so
 * importing a handler module never requires environment variables to
 * already be set (matters for unit tests that construct a handler without
 * invoking it).
 */
export function requireAdmin(): MiddlewareObj<ApiGatewayEvent, ApiGatewayResult> {
  return {
    before: (request) => {
      const user = getCurrentUser(request.event);
      if (user === null) {
        throw new UnauthorizedError();
      }
      const { adminGroupName } = getEnvConfig();
      if (!user.groups.includes(adminGroupName)) {
        throw new ForbiddenError('Admin privileges are required for this action');
      }
      request.event.auth = user;
    },
  };
}
