import { requireProductImagesBucketName, getEnvConfig } from '../config/env';
import type { PresignedUpload, PresignedUploadRequest } from '../domain/upload';
import { ValidationError } from '../errors/app-error';
import { createPresignedPutUrl, generateObjectKey } from '../lib/s3';

export interface UploadService {
  /**
   * Generates a fresh S3 object key and a short-lived presigned PUT URL for
   * it. Never touches the actual image bytes — the browser uploads directly
   * to S3 with the returned URL; see docs/database.md, "Upload Consistency
   * And Security".
   */
  createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUpload>;
}

export interface UploadServiceOptions {
  /** Overridable for tests; defaults to the real S3-backed implementation. */
  presign?: typeof createPresignedPutUrl;
  generateKey?: typeof generateObjectKey;
}

export function createUploadService(options: UploadServiceOptions = {}): UploadService {
  const presign = options.presign ?? createPresignedPutUrl;
  const generateKey = options.generateKey ?? generateObjectKey;

  return {
    async createPresignedUpload(request) {
      const { maxUploadBytes, uploadUrlExpiresSeconds } = getEnvConfig();

      // The schema already bounds contentLength to a generous sanity
      // ceiling; this is the real, configured 5 MB limit. It rejects an
      // over-limit request before a presigned URL is even generated —
      // S3's own `s3:RequestObjectSize` IAM condition is the backstop that
      // makes the limit authoritative even if a client lies about this
      // number, since a declared Content-Length is never itself trusted.
      if (request.contentLength > maxUploadBytes) {
        throw new ValidationError(
          `contentLength must not exceed ${maxUploadBytes} bytes (received ${request.contentLength})`,
        );
      }

      const bucket = requireProductImagesBucketName();
      const key = generateKey(request.contentType);

      const uploadUrl = await presign({
        bucket,
        key,
        contentType: request.contentType,
        expiresInSeconds: uploadUrlExpiresSeconds,
      });

      return {
        key,
        uploadUrl,
        method: 'PUT',
        headers: { 'Content-Type': request.contentType },
        expiresInSeconds: uploadUrlExpiresSeconds,
      };
    },
  };
}
