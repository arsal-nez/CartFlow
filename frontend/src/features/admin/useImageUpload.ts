import { useState } from 'react';

import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  requestPresignedUpload,
  uploadToS3,
  type UploadContentType,
} from '../../api/uploads';

function isAllowedContentType(type: string): type is UploadContentType {
  return (ALLOWED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(type);
}

export interface UseImageUploadResult {
  /** Runs the full submit-metadata → presigned-URL → S3-PUT flow; resolves to the new S3 object key. */
  upload: (file: File) => Promise<string>;
  isUploading: boolean;
  error: string | null;
}

export function useImageUpload(): UseImageUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<string> {
    setError(null);

    if (!isAllowedContentType(file.type)) {
      const message = 'Only JPEG, PNG, or WebP images are supported.';
      setError(message);
      throw new Error(message);
    }

    setIsUploading(true);
    try {
      // 1 & 2: submit metadata, get back a presigned S3 PUT URL + object key.
      const presigned = await requestPresignedUpload({
        contentType: file.type,
        contentLength: file.size,
      });
      // 3: upload the bytes directly to S3 — never through our API.
      await uploadToS3(presigned, file);
      // 4 (attach the key to the product) is the caller's responsibility;
      // this hook only hands back the key once the upload has succeeded.
      return presigned.key;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Image upload failed.';
      setError(message);
      throw cause;
    } finally {
      setIsUploading(false);
    }
  }

  return { upload, isUploading, error };
}
