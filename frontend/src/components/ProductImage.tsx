function getInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase());
  return letters.join('') || '?';
}

export interface ProductImageProps {
  name: string;
  imageKeys: string[];
  className: string;
}

/**
 * Product images live in a private S3 bucket with no public-read path
 * implemented yet (see docs/database.md, "Upload Consistency And
 * Security") — there is no URL this component could honestly render an
 * `<img>` from. Rather than fabricate one, it renders a clearly-labeled
 * placeholder so the layout still reserves and announces an image slot.
 * Once a public delivery path (e.g. CloudFront) exists, this is the only
 * component that needs to change.
 */
export function ProductImage({ name, imageKeys, className }: ProductImageProps) {
  const hasImage = imageKeys.length > 0;
  return (
    <div
      className={className}
      role="img"
      aria-label={hasImage ? `${name} product photo` : `${name} — no product photo available`}
    >
      <span aria-hidden="true">{getInitials(name)}</span>
    </div>
  );
}
