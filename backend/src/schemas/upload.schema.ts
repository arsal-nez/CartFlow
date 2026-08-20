import { z } from 'zod';

import { ALLOWED_IMAGE_CONTENT_TYPES } from '../domain/upload';

/**
 * Request validation for `POST /api/v1/uploads/presigned-url`.
 *
 * Deliberately has no `fileName` (or any other client-supplied naming)
 * field: the object key is generated entirely server-side
 * (`lib/s3.ts#generateObjectKey`), so there is nothing here for a client
 * name to influence. `contentLength`'s upper bound here is a generous sanity
 * ceiling to reject obviously-bogus values before a presigned URL is even
 * generated; the authoritative 5 MB limit is enforced by the upload service
 * against `MAX_UPLOAD_BYTES` and, independently, by S3 itself at PUT time —
 * see `services/upload.service.ts` and docs/database.md.
 */

const SANITY_CEILING_BYTES = 20 * 1024 * 1024; // 20 MB

export const presignedUploadBodySchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_CONTENT_TYPES),
  contentLength: z
    .number({ invalid_type_error: 'contentLength must be a number' })
    .int('contentLength must be an integer')
    .positive('contentLength must be a positive integer')
    .max(SANITY_CEILING_BYTES, `contentLength must be at most ${SANITY_CEILING_BYTES} bytes`),
});

export type PresignedUploadBody = z.infer<typeof presignedUploadBodySchema>;
