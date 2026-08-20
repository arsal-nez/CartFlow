import { z } from 'zod';

/**
 * Mirrors `backend/src/schemas/product.schema.ts` field-for-field (max
 * lengths, the "no '#'" rule on categoryId — it's a DynamoDB key-segment
 * delimiter — and the price ceiling), so a form submission that passes
 * client-side validation should never bounce off server-side validation.
 * `price` is a decimal string in the form (what an admin types, e.g.
 * "19.99"); it's converted to integer cents at submit time, not here,
 * since priceCents is what the API and the rest of the app use everywhere.
 */

const MAX_PRICE_CENTS = 100_000_000; // Matches the backend's sanity ceiling.

export const productFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name must be at most 200 characters'),
  description: z.string().max(4000, 'Description must be at most 4000 characters'),
  categoryId: z
    .string()
    .trim()
    .min(1, 'Category is required')
    .max(64, 'Category must be at most 64 characters')
    .regex(/^[^#]+$/, 'Category must not contain "#"'),
  price: z
    .string()
    .trim()
    .min(1, 'Price is required')
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a price like 19.99')
    .refine((value) => Number(value) > 0, 'Price must be greater than zero')
    .refine(
      (value) => Math.round(Number(value) * 100) <= MAX_PRICE_CENTS,
      `Price must be at most ${(MAX_PRICE_CENTS / 100).toLocaleString()}`,
    ),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code, e.g. USD')
    .transform((value) => value.toUpperCase()),
  status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

export function centsToPriceInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function priceInputToCents(price: string): number {
  return Math.round(Number(price) * 100);
}
