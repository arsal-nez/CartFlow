import { useRef, useState, type ChangeEvent } from 'react';

import { useImageUpload } from '../../features/admin/useImageUpload';
import { ProductImage } from '../ProductImage';

export interface ImageUploadFieldProps {
  productName: string;
  imageKeys: string[];
  onChange: (imageKeys: string[]) => void;
}

/**
 * Handles the full upload flow (submit metadata → presigned URL → PUT to
 * S3) and displays the result immediately via a local `URL.createObjectURL`
 * preview of the file just uploaded — not a fetch from S3, since the
 * bucket has no public-read path (same limitation and same honest
 * placeholder pattern as the customer-facing `ProductImage`; see its
 * doc comment). Previously-saved keys (no local file in memory) fall back
 * to that placeholder. `onChange` only updates local form state — the key
 * isn't persisted to the product until the surrounding form is submitted.
 */
export function ImageUploadField({ productName, imageKeys, onChange }: ImageUploadFieldProps) {
  const { upload, isUploading, error } = useImageUpload();
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (file === undefined) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const key = await upload(file);
      setPreviewUrls((prev) => ({ ...prev, [key]: objectUrl }));
      onChange([...imageKeys, key]);
    } catch {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function handleRemove(key: string) {
    onChange(imageKeys.filter((existing) => existing !== key));
    setPreviewUrls((prev) => {
      const url = prev[key];
      if (url === undefined) {
        return prev;
      }
      URL.revokeObjectURL(url);
      return Object.fromEntries(
        Object.entries(prev).filter(([existingKey]) => existingKey !== key),
      );
    });
  }

  return (
    <div className="field">
      <label htmlFor="product-image-upload">Product images</label>

      {imageKeys.length > 0 && (
        <ul className="image-upload-grid">
          {imageKeys.map((key) => (
            <li key={key} className="image-upload-item">
              {previewUrls[key] !== undefined ? (
                <img
                  src={previewUrls[key]}
                  alt={`${productName} — newly uploaded`}
                  className="image-upload-item__preview"
                />
              ) : (
                <ProductImage
                  name={productName}
                  imageKeys={[key]}
                  className="image-upload-item__preview"
                />
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleRemove(key)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        id="product-image-upload"
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => void handleFileSelected(event)}
        disabled={isUploading}
      />
      {isUploading && <span className="field-hint">Uploading…</span>}
      {error !== null && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
      <span className="field-hint">
        Uploaded directly from your browser to S3 via a short-lived, single-object link — the image
        bytes never pass through the API, and no AWS credentials ever reach the browser.
      </span>
    </div>
  );
}
