/**
 * Product image uploads go browser → S3 directly via a presigned PUT URL;
 * the Lambda only ever handles the small JSON request/response for
 * generating that URL, never the image bytes themselves.
 */

export const ALLOWED_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

/** Default cap enforced when `MAX_UPLOAD_BYTES` is unset — see `config/env.ts`. */
export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * The object key's extension is derived from this fixed map, never from a
 * client-supplied file name — a file name is not even accepted in the
 * request. This rules out path traversal (`../../etc/passwd`), null-byte
 * tricks, and extension/content-type mismatches by construction.
 */
const EXTENSION_BY_CONTENT_TYPE: Record<AllowedImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extensionForContentType(contentType: AllowedImageContentType): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType];
}

export interface PresignedUploadRequest {
  contentType: AllowedImageContentType;
  /** Client-declared byte size; a cheap early rejection, not the authoritative check — see docs/database.md. */
  contentLength: number;
}

export interface PresignedUpload {
  /** The randomly generated S3 object key the browser must PUT to and the app must reference later. */
  key: string;
  uploadUrl: string;
  method: 'PUT';
  /**
   * Headers the browser's PUT request should send. `Content-Type` here is a
   * convention, not a signature requirement: S3's presigner cannot sign
   * `content-type` for a PUT URL (see `lib/s3.ts#createPresignedPutUrl`),
   * so sending a different value will not make the upload fail. Included so
   * the uploaded object ends up with correct content-type metadata.
   */
  headers: Record<string, string>;
  expiresInSeconds: number;
}
