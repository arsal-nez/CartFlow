import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { extensionForContentType, type AllowedImageContentType } from '../domain/upload';

/**
 * Shared S3 plumbing for presigned product-image uploads. This module never
 * touches `process.env` or the request/response shape — it is a pure
 * wrapper around the AWS SDK, so `createPresignedPutUrl` can be unit-tested
 * with an injected fake client exactly like the DynamoDB repositories are
 * (see `lib/dynamodb.ts`).
 */

let cachedClient: S3Client | undefined;

export function createS3Client(baseClient?: S3Client): S3Client {
  return (
    baseClient ??
    new S3Client({
      ...(process.env.AWS_REGION === undefined ? {} : { region: process.env.AWS_REGION }),
    })
  );
}

/** Lambda-container-scoped singleton so connections are reused across invocations. */
export function getS3Client(): S3Client {
  cachedClient ??= createS3Client();
  return cachedClient;
}

/** Test seam: drops the memoised client. */
export function resetS3Client(): void {
  cachedClient = undefined;
}

/**
 * Generates the object key the browser will upload to. It is always
 * `products/{randomUUID}.{ext}` — a fresh random id, never anything derived
 * from client input (no client-supplied file name is even accepted; see
 * `domain/upload.ts`) — so a malicious or malformed name can't influence
 * where the object lands or collide with another upload.
 */
export function generateObjectKey(contentType: AllowedImageContentType): string {
  return `products/${randomUUID()}.${extensionForContentType(contentType)}`;
}

export interface CreatePresignedPutUrlInput {
  client?: S3Client;
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds: number;
}

/**
 * Signs a PUT URL scoped to exactly one bucket and object key.
 *
 * What this signature *does* guarantee: the request must be an exact PUT to
 * this `bucket`/`key`, within `expiresInSeconds`, using these credentials —
 * a client cannot redirect the upload to a different key or bucket, or
 * reuse the URL past expiry, without invalidating the signature.
 *
 * What it deliberately does *not* guarantee, and should not be assumed to:
 * `@aws-sdk/s3-request-presigner`'s `S3RequestPresigner` unconditionally
 * adds `content-type` to its unsignable-headers set for every S3 presigned
 * URL (this is internal SDK behavior, not a flag we control) — so the `PUT`
 * can arrive with any `Content-Type` header, or none, regardless of what
 * `ContentType` was set on this command. `ContentType` is still passed so
 * S3 stores it as the object's metadata *if* the browser happens to send a
 * matching header, but it is advisory, not enforced by the signature. See
 * `tests/unit/lib/s3.test.ts` (this is asserted directly, not assumed) and
 * docs/database.md, "Upload Consistency And Security", for the layered
 * mitigations and the follow-up validation this implies for whatever admin
 * flow later attaches an uploaded key to a product.
 *
 * Object size is a separate, fully enforced guarantee: a presigned PUT
 * cannot embed a size limit in its own signature (that is a
 * presigned-POST-policy feature), so the 5 MB cap is enforced independently
 * by an `s3:RequestObjectSize` condition on the signing role's IAM policy
 * (see `serverless.yml`) — that check runs against the real uploaded byte
 * count regardless of anything declared when the URL was requested.
 */
export async function createPresignedPutUrl(input: CreatePresignedPutUrlInput): Promise<string> {
  const client = input.client ?? getS3Client();
  const command = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    ContentType: input.contentType,
  });
  return getSignedUrl(client, command, { expiresIn: input.expiresInSeconds });
}
