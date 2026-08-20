import {
  createProductBodySchema,
  listProductsQuerySchema,
  productIdPathSchema,
  updateProductBodySchema,
} from '../../../src/schemas/product.schema';

describe('productIdPathSchema', () => {
  it('accepts a UUID', () => {
    const result = productIdPathSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111' });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    const result = productIdPathSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing id', () => {
    const result = productIdPathSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('listProductsQuerySchema', () => {
  it('accepts an empty query', () => {
    const result = listProductsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('coerces a string limit to a number', () => {
    const result = listProductsQuerySchema.safeParse({ limit: '10' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(10);
  });

  it('rejects a limit above the server cap', () => {
    const result = listProductsQuerySchema.safeParse({ limit: '5000' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer or non-positive limit', () => {
    expect(listProductsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listProductsQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
  });

  it('rejects a categoryId containing "#"', () => {
    const result = listProductsQuerySchema.safeParse({ categoryId: 'c#1' });
    expect(result.success).toBe(false);
  });
});

describe('createProductBodySchema', () => {
  const validBody = {
    name: 'Trail Bottle',
    description: 'Insulated bottle',
    categoryId: 'drinkware',
    priceCents: 2499,
    currency: 'usd',
    status: 'DRAFT',
  };

  it('accepts a valid body and normalizes currency to upper case', () => {
    const result = createProductBodySchema.safeParse(validBody);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('USD');
  });

  it('sanitizes name and description, stripping tags and collapsing whitespace', () => {
    const result = createProductBodySchema.safeParse({
      ...validBody,
      name: '  <b>Trail</b>   Bottle  ',
      description: '<script>alert(1)</script>Insulated',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Trail Bottle');
      expect(result.data.description).toBe('alert(1)Insulated');
    }
  });

  it('defaults description to an empty string when omitted', () => {
    const withoutDescription = {
      name: validBody.name,
      categoryId: validBody.categoryId,
      priceCents: validBody.priceCents,
      currency: validBody.currency,
      status: validBody.status,
    };
    const result = createProductBodySchema.safeParse(withoutDescription);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe('');
  });

  it('rejects a name that sanitizes down to nothing', () => {
    const result = createProductBodySchema.safeParse({ ...validBody, name: '<script></script>' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = createProductBodySchema.safeParse({ ...validBody, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a categoryId containing "#"', () => {
    const result = createProductBodySchema.safeParse({ ...validBody, categoryId: 'drink#ware' });
    expect(result.success).toBe(false);
  });

  it('rejects a negative or non-integer priceCents', () => {
    expect(createProductBodySchema.safeParse({ ...validBody, priceCents: -1 }).success).toBe(false);
    expect(createProductBodySchema.safeParse({ ...validBody, priceCents: 1.5 }).success).toBe(
      false,
    );
  });

  it('rejects a currency that is not a 3-letter code', () => {
    expect(createProductBodySchema.safeParse({ ...validBody, currency: 'US' }).success).toBe(false);
    expect(createProductBodySchema.safeParse({ ...validBody, currency: 'USDD' }).success).toBe(
      false,
    );
  });

  it('rejects an unrecognised status', () => {
    const result = createProductBodySchema.safeParse({ ...validBody, status: 'DELETED' });
    expect(result.success).toBe(false);
  });

  it('leaves status unset when omitted', () => {
    const withoutStatus = {
      name: validBody.name,
      description: validBody.description,
      categoryId: validBody.categoryId,
      priceCents: validBody.priceCents,
      currency: validBody.currency,
    };
    const result = createProductBodySchema.safeParse(withoutStatus);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBeUndefined();
  });
});

describe('updateProductBodySchema', () => {
  it('accepts a single-field patch', () => {
    const result = updateProductBodySchema.safeParse({ priceCents: 1999 });
    expect(result.success).toBe(true);
  });

  it('rejects an empty patch', () => {
    const result = updateProductBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('sanitizes name when present', () => {
    const result = updateProductBodySchema.safeParse({ name: '  <i>New</i> Name  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('New Name');
  });
});
