import { z } from 'zod';

/**
 * Request validation for the admin inventory endpoints
 * (`GET`/`PUT /api/v1/admin/inventory/{id}`). The customer-facing stock
 * endpoint (`GET /api/v1/products/{id}/inventory`) has no request body and
 * needs no schema of its own beyond `productIdPathSchema`, which this
 * reuses.
 */

export { productIdPathSchema, type ProductIdPath } from './product.schema';

const nonNegativeIntSchema = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .nonnegative(`${label} must not be negative`);

export const updateInventoryBodySchema = z
  .object({
    availableQuantity: nonNegativeIntSchema('availableQuantity').optional(),
    reorderThreshold: nonNegativeIntSchema('reorderThreshold').optional(),
    /** Optimistic concurrency guard against the stored `updatedAt`. */
    expectedUpdatedAt: z.string().trim().min(1).optional(),
  })
  .refine((data) => data.availableQuantity !== undefined || data.reorderThreshold !== undefined, {
    message: 'At least one of availableQuantity or reorderThreshold must be provided',
  });

export type UpdateInventoryBody = z.infer<typeof updateInventoryBodySchema>;
