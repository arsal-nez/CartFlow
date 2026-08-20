import { apiFetch } from './client';

/**
 * Product image uploads, mirroring `backend/src/handlers/uploads/create-presigned-url.ts`:
 *
 *   1. Browser calls our API with the image's metadata (content type, byte size).
 *   2. Our API (admin-only) hands back a short-lived S3 presigned PUT URL.
 *   3. The browser PUTs the file bytes straight to S3 with that URL.
 *   4. The caller attaches the returned object `key` to the product (a
 *      normal product create/update call — see `api/adminProducts.ts`).
 *
 * At no point does the browser receive AWS credentials: the presigned URL
 * is a time-limited, single-object capability, not an IAM key/secret pair,
 * and step 3 talks to S3 directly rather than through our API.
 */

export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export const ALLOWED_UPLOAD_CONTENT_TYPES: readonly UploadContentType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export async function requestPresignedUpload(
  input: { contentType: UploadContentType; contentLength: number },
  signal?: AbortSignal,
): Promise<PresignedUpload> {
  return apiFetch<PresignedUpload>('/api/v1/uploads/presigned-url', {
    method: 'POST',
    body: input,
    signal,
  });
}

/**
 * PUTs the file straight to S3 using the presigned URL. Deliberately a raw
 * `fetch`, not routed through `apiFetch`/`apiClient`: this request must not
 * carry our API's `Authorization` header and must not go to our API at
 * all — the presigned URL itself is the only credential involved.
 */
export async function uploadToS3(upload: PresignedUpload, file: File): Promise<void> {
  const response = await fetch(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });
  if (!response.ok) {
    throw new Error(
      `Image upload to storage failed (status ${response.status}). Please try again.`,
    );
  }
}
