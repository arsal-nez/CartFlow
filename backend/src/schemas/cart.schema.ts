import { z } from 'zod';

/**
 * Request validation for the Cart API. `quantity` is capped at a sane retail
 * ceiling — not a business rule, just defense against a client sending an
 * absurd number before it ever reaches the inventory check.
 */

const MAX_LINE_QUANTITY = 1000;

const quantitySchema = z
  .number({ invalid_type_error: 'quantity must be a number' })
  .int('quantity must be an integer')
  .positive('quantity must be a positive integer')
  .max(MAX_LINE_QUANTITY, `quantity must be at most ${MAX_LINE_QUANTITY}`);

export const cartItemProductIdPathSchema = z.object({
  productId: z.string().trim().uuid('productId must be a valid UUID'),
});

/**
 * `POST /api/v1/cart/items` — add a product to the cart. Only `productId`
 * and `quantity` are accepted. A client-supplied `userId`, `priceCents`, or
 * similar field would be silently ignored even if sent, because this schema
 * has no such property to parse it into — the authenticated caller's id
 * comes from the verified JWT (`getCurrentUser()`), never from the body.
 */
export const addCartItemBodySchema = z.object({
  productId: z.string().trim().uuid('productId must be a valid UUID'),
  quantity: quantitySchema,
});

/** `PATCH /api/v1/cart/items/{productId}` — set a line to an absolute quantity. */
export const updateCartItemBodySchema = z.object({
  quantity: quantitySchema,
});

export type CartItemProductIdPath = z.infer<typeof cartItemProductIdPathSchema>;
export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;
export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;
