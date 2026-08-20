import { presignedUploadBodySchema } from '../../../src/schemas/upload.schema';

describe('presignedUploadBodySchema', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (contentType) => {
    const result = presignedUploadBodySchema.safeParse({ contentType, contentLength: 1024 });
    expect(result.success).toBe(true);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/html', ''])(
    'rejects a disallowed content type (%p)',
    (contentType) => {
      const result = presignedUploadBodySchema.safeParse({ contentType, contentLength: 1024 });
      expect(result.success).toBe(false);
    },
  );

  it('has no field for a client-supplied file name — unknown keys are simply dropped', () => {
    const result = presignedUploadBodySchema.safeParse({
      contentType: 'image/png',
      contentLength: 1024,
      fileName: '../../etc/passwd',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('fileName');
      expect(Object.keys(result.data).sort()).toEqual(['contentLength', 'contentType']);
    }
  });

  it('rejects a missing contentType', () => {
    expect(presignedUploadBodySchema.safeParse({ contentLength: 1024 }).success).toBe(false);
  });

  it('rejects a missing contentLength', () => {
    expect(presignedUploadBodySchema.safeParse({ contentType: 'image/png' }).success).toBe(false);
  });

  it.each([0, -1, 1.5])(
    'rejects a non-positive or non-integer contentLength (%p)',
    (contentLength) => {
      const result = presignedUploadBodySchema.safeParse({
        contentType: 'image/png',
        contentLength,
      });
      expect(result.success).toBe(false);
    },
  );

  it('rejects a contentLength far beyond any plausible image, before it ever reaches the service', () => {
    const result = presignedUploadBodySchema.safeParse({
      contentType: 'image/png',
      contentLength: 100 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a contentLength between the schema sanity ceiling and the real 5 MB business limit — that gate belongs to the service', () => {
    // 8 MB: under the schema's 20 MB sanity ceiling, over the real 5 MB cap.
    // The service (not the schema) is responsible for the authoritative reject.
    const result = presignedUploadBodySchema.safeParse({
      contentType: 'image/png',
      contentLength: 8 * 1024 * 1024,
    });
    expect(result.success).toBe(true);
  });
});
