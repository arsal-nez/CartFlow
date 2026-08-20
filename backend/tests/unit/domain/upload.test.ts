import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  DEFAULT_MAX_UPLOAD_BYTES,
  extensionForContentType,
} from '../../../src/domain/upload';

describe('ALLOWED_IMAGE_CONTENT_TYPES', () => {
  it('is exactly the three approved image types', () => {
    expect(ALLOWED_IMAGE_CONTENT_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('extensionForContentType', () => {
  it('maps each allowed content type to its extension', () => {
    expect(extensionForContentType('image/jpeg')).toBe('jpg');
    expect(extensionForContentType('image/png')).toBe('png');
    expect(extensionForContentType('image/webp')).toBe('webp');
  });
});

describe('DEFAULT_MAX_UPLOAD_BYTES', () => {
  it('is 5 MB', () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });
});
