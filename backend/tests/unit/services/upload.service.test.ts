import { resetEnvConfig } from '../../../src/config/env';
import { ValidationError } from '../../../src/errors/app-error';
import { createUploadService } from '../../../src/services/upload.service';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    CARTFLOW_TABLE_NAME: 'cartflow-test',
    PRODUCT_IMAGES_BUCKET_NAME: 'cartflow-test-product-images',
    UPLOAD_URL_EXPIRES_SECONDS: '300',
    MAX_UPLOAD_BYTES: '5242880', // 5 MB
  };
  resetEnvConfig();
});

afterAll(() => {
  process.env = originalEnv;
  resetEnvConfig();
});

function createService(overrides: { presign?: jest.Mock; generateKey?: jest.Mock } = {}) {
  const presign = overrides.presign ?? jest.fn().mockResolvedValue('https://s3.example.com/signed');
  const generateKey =
    overrides.generateKey ?? jest.fn().mockReturnValue('products/generated-key.jpg');
  const service = createUploadService({ presign, generateKey });
  return { service, presign, generateKey };
}

describe('createPresignedUpload', () => {
  it('generates a key, presigns it against the configured bucket, and returns the expiry', async () => {
    const { service, presign, generateKey } = createService();

    const upload = await service.createPresignedUpload({
      contentType: 'image/png',
      contentLength: 1024,
    });

    expect(generateKey).toHaveBeenCalledWith('image/png');
    expect(presign).toHaveBeenCalledWith({
      bucket: 'cartflow-test-product-images',
      key: 'products/generated-key.jpg',
      contentType: 'image/png',
      expiresInSeconds: 300,
    });
    expect(upload).toEqual({
      key: 'products/generated-key.jpg',
      uploadUrl: 'https://s3.example.com/signed',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      expiresInSeconds: 300,
    });
  });

  it('rejects a contentLength beyond the configured MAX_UPLOAD_BYTES without presigning anything', async () => {
    const { service, presign } = createService();

    await expect(
      service.createPresignedUpload({ contentType: 'image/jpeg', contentLength: 5_242_881 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(presign).not.toHaveBeenCalled();
  });

  it('accepts a contentLength exactly at the configured limit', async () => {
    const { service } = createService();

    await expect(
      service.createPresignedUpload({ contentType: 'image/jpeg', contentLength: 5_242_880 }),
    ).resolves.toBeDefined();
  });

  it('honours a non-default MAX_UPLOAD_BYTES from configuration', async () => {
    process.env.MAX_UPLOAD_BYTES = '1000';
    resetEnvConfig();
    const { service } = createService();

    await expect(
      service.createPresignedUpload({ contentType: 'image/jpeg', contentLength: 1001 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fails fast with a clear error when PRODUCT_IMAGES_BUCKET_NAME is not configured', async () => {
    delete process.env.PRODUCT_IMAGES_BUCKET_NAME;
    resetEnvConfig();
    const { service, presign } = createService();

    await expect(
      service.createPresignedUpload({ contentType: 'image/jpeg', contentLength: 1024 }),
    ).rejects.toThrow('PRODUCT_IMAGES_BUCKET_NAME');
    expect(presign).not.toHaveBeenCalled();
  });
});
