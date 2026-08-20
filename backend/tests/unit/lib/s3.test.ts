import { S3Client } from '@aws-sdk/client-s3';

import { createPresignedPutUrl, generateObjectKey } from '../../../src/lib/s3';

/**
 * `createPresignedPutUrl` is exercised against a real `S3Client` configured
 * with static, fake credentials rather than a mocked `.send` — signing a
 * presigned URL is a purely local computation (no network call), so this
 * gives genuine confidence the signature actually encodes what it should
 * (bucket, key, content-type, expiry) without hitting AWS.
 */
function fakeS3Client(): S3Client {
  return new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'test-access-key-id', secretAccessKey: 'test-secret-access-key' },
  });
}

describe('generateObjectKey', () => {
  it('places the object under products/ with the extension for its content type', () => {
    expect(generateObjectKey('image/jpeg')).toMatch(/^products\/[0-9a-f-]{36}\.jpg$/);
    expect(generateObjectKey('image/png')).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    expect(generateObjectKey('image/webp')).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);
  });

  it('generates a fresh random key on every call — never derived from client input', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateObjectKey('image/png')));
    expect(keys.size).toBe(20);
  });
});

describe('createPresignedPutUrl', () => {
  it('signs a URL for exactly the given bucket and key', async () => {
    const url = await createPresignedPutUrl({
      client: fakeS3Client(),
      bucket: 'cartflow-test-bucket',
      key: 'products/11111111-1111-4111-8111-111111111111.jpg',
      contentType: 'image/jpeg',
      expiresInSeconds: 300,
    });

    const parsed = new URL(url);
    expect(parsed.hostname).toContain('cartflow-test-bucket');
    expect(parsed.pathname).toBe('/products/11111111-1111-4111-8111-111111111111.jpg');
  });

  it('encodes the requested expiry as X-Amz-Expires', async () => {
    const url = await createPresignedPutUrl({
      client: fakeS3Client(),
      bucket: 'cartflow-test-bucket',
      key: 'products/x.jpg',
      contentType: 'image/jpeg',
      expiresInSeconds: 120,
    });

    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('120');
  });

  it('signs the host header (the object identity), at minimum', async () => {
    const url = await createPresignedPutUrl({
      client: fakeS3Client(),
      bucket: 'cartflow-test-bucket',
      key: 'products/x.png',
      contentType: 'image/png',
      expiresInSeconds: 300,
    });

    const signedHeaders = new URL(url).searchParams.get('X-Amz-SignedHeaders');
    expect(signedHeaders).toContain('host');
  });

  // This is intentionally testing a *limitation*, not a feature: the AWS SDK's
  // S3 presigner (`S3RequestPresigner.prepareRequest`) unconditionally treats
  // `content-type` as unsignable for every S3 presigned URL, so it can never
  // appear in `X-Amz-SignedHeaders` — the signature is identical no matter
  // what `contentType` is passed in. See the doc comment on
  // `createPresignedPutUrl` and docs/database.md for why this is expected and
  // how it's mitigated elsewhere, rather than assumed away.
  it('does NOT sign content-type — a presigned PUT cannot pin the upload header, by SDK design', async () => {
    const client = fakeS3Client();
    const base = {
      client,
      bucket: 'cartflow-test-bucket',
      key: 'products/x.jpg',
      expiresInSeconds: 300,
    };

    const jpegUrl = await createPresignedPutUrl({ ...base, contentType: 'image/jpeg' });
    const pngUrl = await createPresignedPutUrl({ ...base, contentType: 'image/png' });

    expect(new URL(jpegUrl).searchParams.get('X-Amz-SignedHeaders')).not.toContain('content-type');
    expect(new URL(jpegUrl).searchParams.get('X-Amz-Signature')).toBe(
      new URL(pngUrl).searchParams.get('X-Amz-Signature'),
    );
  });
});
