import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import httpJsonBodyParser from '@middy/http-json-body-parser';

import { requireAdmin } from '../../middleware/admin';
import { errorHandler } from '../../middleware/error-handler';
import { validate } from '../../middleware/validate';
import { successResponse } from '../../responses/response';
import { presignedUploadBodySchema, type PresignedUploadBody } from '../../schemas/upload.schema';
import { createUploadService, type UploadService } from '../../services/upload.service';
import type { ApiGatewayEvent, ApiGatewayResult } from '../../types/http';
import { getRequestId } from '../../utils/request-id';
import { requireValidated } from '../../utils/validated-request';

/**
 * `POST /api/v1/uploads/presigned-url`
 *
 * Admin only. Returns a short-lived S3 presigned PUT URL and the object key
 * the browser must upload the image to directly:
 *
 *   Browser -> API -> Lambda -> presigned URL -> browser -> S3
 *
 * The Lambda never receives or forwards the image bytes. See
 * `UploadService.createPresignedUpload` and docs/database.md, "Upload
 * Consistency And Security", for exactly what is and isn't enforced (object
 * size genuinely is, at the S3 layer; content-type is only an allowlist on
 * which URLs get generated, not on the resulting upload — a real
 * limitation of presigned PUT, documented rather than glossed over) and how
 * the object key is generated.
 *
 * Nothing is persisted by this call: no product is updated, no DB row is
 * written. The returned `key` is only attached to a product by a later,
 * separate admin action (out of scope here) after the browser's upload to
 * S3 succeeds — this endpoint only ever hands out a place to put bytes, and
 * never accepts an already-hosted image URL as a substitute.
 */

let defaultService: UploadService | undefined;
function getDefaultService(): UploadService {
  defaultService ??= createUploadService();
  return defaultService;
}

export function buildCreatePresignedUploadHandler(service?: UploadService) {
  const baseHandler = async (event: ApiGatewayEvent): Promise<ApiGatewayResult> => {
    const { body } = requireValidated<{ body: PresignedUploadBody }>(event);
    const upload = await (service ?? getDefaultService()).createPresignedUpload(body);
    return successResponse(upload, getRequestId(event));
  };

  return middy(baseHandler)
    .use(httpCors())
    .use(httpJsonBodyParser({ disableContentTypeError: true }))
    .use(requireAdmin())
    .use(validate({ body: presignedUploadBodySchema }))
    .use(errorHandler());
}

export const handler = buildCreatePresignedUploadHandler();
