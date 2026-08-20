import { buildCreatePresignedUploadHandler } from '../../../src/handlers/uploads/create-presigned-url';
import { resetEnvConfig } from '../../../src/config/env';
import { ValidationError } from '../../../src/errors/app-error';
import type { UploadService } from '../../../src/services/upload.service';
import { buildEvent, fakeLambdaContext, parseBody } from '../helpers/fake-event';

const ADMIN_CLAIMS = { sub: 'admin-1', 'cognito:groups': '["admin"]' };
const CUSTOMER_CLAIMS = { sub: 'user-1', 'cognito:groups': '["customer"]' };

const SAMPLE_UPLOAD = {
  key: 'products/11111111-1111-4111-8111-111111111111.jpg',
  uploadUrl: 'https://cartflow-test-product-images.s3.amazonaws.com/products/...',
  method: 'PUT' as const,
  headers: { 'Content-Type': 'image/jpeg' },
  expiresInSeconds: 300,
};

function createFakeUploadService(): { service: UploadService; createPresignedUpload: jest.Mock } {
  const createPresignedUpload = jest.fn();
  return { service: { createPresignedUpload }, createPresignedUpload };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv, CARTFLOW_TABLE_NAME: 'cartflow-test', ADMIN_GROUP_NAME: 'admin' };
  resetEnvConfig();
});

afterAll(() => {
  process.env = originalEnv;
  resetEnvConfig();
});

describe('POST /api/v1/uploads/presigned-url', () => {
  it('returns the presigned upload for an admin caller', async () => {
    const fake = createFakeUploadService();
    fake.createPresignedUpload.mockResolvedValueOnce(SAMPLE_UPLOAD);
    const handler = buildCreatePresignedUploadHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/uploads/presigned-url',
        body: { contentType: 'image/jpeg', contentLength: 12_345 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toMatchObject({ ok: true, data: SAMPLE_UPLOAD });
    expect(fake.createPresignedUpload).toHaveBeenCalledWith({
      contentType: 'image/jpeg',
      contentLength: 12_345,
    });
  });

  it('returns 401 UNAUTHORIZED for an unauthenticated caller', async () => {
    const fake = createFakeUploadService();
    const handler = buildCreatePresignedUploadHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/uploads/presigned-url',
        body: { contentType: 'image/jpeg', contentLength: 1024 },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
    expect(fake.createPresignedUpload).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for an authenticated non-admin caller', async () => {
    const fake = createFakeUploadService();
    const handler = buildCreatePresignedUploadHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/uploads/presigned-url',
        body: { contentType: 'image/jpeg', contentLength: 1024 },
        claims: CUSTOMER_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(403);
    expect(fake.createPresignedUpload).not.toHaveBeenCalled();
  });

  it('checks authorization before request validation', async () => {
    const fake = createFakeUploadService();
    const handler = buildCreatePresignedUploadHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/uploads/presigned-url',
        body: { contentType: 'not-an-allowed-type' },
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(401);
  });

  it('returns 400 VALIDATION_ERROR for a disallowed content type, without calling the service', async () => {
    const fake = createFakeUploadService();
    const handler = buildCreatePresignedUploadHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/uploads/presigned-url',
        body: { contentType: 'image/gif', contentLength: 1024 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.createPresignedUpload).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a missing contentLength', async () => {
    const fake = createFakeUploadService();
    const handler = buildCreatePresignedUploadHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/uploads/presigned-url',
        body: { contentType: 'image/jpeg' },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(fake.createPresignedUpload).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when the service rejects an over-limit contentLength', async () => {
    const fake = createFakeUploadService();
    fake.createPresignedUpload.mockRejectedValueOnce(
      new ValidationError('contentLength must not exceed 5242880 bytes (received 8000000)'),
    );
    const handler = buildCreatePresignedUploadHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/uploads/presigned-url',
        body: { contentType: 'image/jpeg', contentLength: 8_000_000 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns 500 INTERNAL_ERROR when the service throws unexpectedly', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeUploadService();
    fake.createPresignedUpload.mockRejectedValueOnce(new Error('S3 is unreachable'));
    const handler = buildCreatePresignedUploadHandler(fake.service);

    const result = await handler(
      buildEvent({
        method: 'POST',
        path: '/api/v1/uploads/presigned-url',
        body: { contentType: 'image/jpeg', contentLength: 1024 },
        claims: ADMIN_CLAIMS,
      }),
      fakeLambdaContext,
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).error).toMatchObject({ code: 'INTERNAL_ERROR' });
    consoleSpy.mockRestore();
  });
});
