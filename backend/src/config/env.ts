import { z } from 'zod';

import { DEFAULT_MAX_UPLOAD_BYTES } from '../domain/upload';

/**
 * Typed, fail-fast environment configuration. Application code should read
 * configuration through `getEnvConfig()`, never `process.env` directly, so a
 * missing or malformed variable is caught with a clear error instead of
 * surfacing as an obscure runtime failure deep in a handler.
 */

const envSchema = z.object({
  NODE_ENV: z.string().min(1).default('development'),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  CARTFLOW_TABLE_NAME: z.string().min(1, 'CARTFLOW_TABLE_NAME is required'),
  ADMIN_GROUP_NAME: z.string().min(1).default('admin'),
  DEFAULT_PAGE_LIMIT: z.coerce.number().int().positive().default(20),
  MAX_PAGE_LIMIT: z.coerce.number().int().positive().default(100),
  // Optional at this shared level, not required: getEnvConfig() is called by
  // plenty of code (admin auth, product listing) that has nothing to do with
  // uploads, and making this mandatory would fail those callers too. Only
  // the upload service actually needs it, and it fails fast itself — see
  // requireProductImagesBucketName() below — the moment it's actually used
  // without a bucket configured.
  PRODUCT_IMAGES_BUCKET_NAME: z.string().min(1).optional(),
  UPLOAD_URL_EXPIRES_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(DEFAULT_MAX_UPLOAD_BYTES),
});

export interface EnvConfig {
  nodeEnv: string;
  awsRegion: string;
  tableName: string;
  adminGroupName: string;
  defaultPageLimit: number;
  maxPageLimit: number;
  productImagesBucketName: string | undefined;
  uploadUrlExpiresSeconds: number;
  maxUploadBytes: number;
}

let cached: EnvConfig | undefined;

function parse(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  const env = result.data;
  return {
    nodeEnv: env.NODE_ENV,
    awsRegion: env.AWS_REGION,
    tableName: env.CARTFLOW_TABLE_NAME,
    adminGroupName: env.ADMIN_GROUP_NAME,
    defaultPageLimit: env.DEFAULT_PAGE_LIMIT,
    maxPageLimit: env.MAX_PAGE_LIMIT,
    productImagesBucketName: env.PRODUCT_IMAGES_BUCKET_NAME,
    uploadUrlExpiresSeconds: env.UPLOAD_URL_EXPIRES_SECONDS,
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
  };
}

/** Lazily parses and memoises configuration on first use. */
export function getEnvConfig(): EnvConfig {
  cached ??= parse();
  return cached;
}

/** Test seam: drops the memoised config so a changed `process.env` is re-read. */
export function resetEnvConfig(): void {
  cached = undefined;
}

/**
 * Fails fast, with a clear message, the moment upload code actually needs
 * the bucket — rather than `PRODUCT_IMAGES_BUCKET_NAME` being required for
 * every unrelated handler that happens to call `getEnvConfig()`.
 */
export function requireProductImagesBucketName(): string {
  const { productImagesBucketName } = getEnvConfig();
  if (productImagesBucketName === undefined) {
    throw new Error('PRODUCT_IMAGES_BUCKET_NAME is not set');
  }
  return productImagesBucketName;
}
