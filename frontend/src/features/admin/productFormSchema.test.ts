import { centsToPriceInput, priceInputToCents, productFormSchema } from './productFormSchema';

const VALID = {
  name: 'Trail Bottle',
  description: 'Insulated bottle',
  categoryId: 'drinkware',
  price: '19.99',
  currency: 'usd',
  status: 'DRAFT' as const,
};

describe('productFormSchema', () => {
  it('accepts a valid form and upper-cases the currency', () => {
    const result = productFormSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('USD');
  });

  it('rejects a missing name', () => {
    expect(productFormSchema.safeParse({ ...VALID, name: '' }).success).toBe(false);
  });

  it('rejects a categoryId containing "#" — it is a DynamoDB key-segment delimiter', () => {
    expect(productFormSchema.safeParse({ ...VALID, categoryId: 'drink#ware' }).success).toBe(false);
  });

  it.each(['0', '-5', '-5.00', '0.00'])('rejects a non-positive price (%p)', (price) => {
    expect(productFormSchema.safeParse({ ...VALID, price }).success).toBe(false);
  });

  it.each(['abc', '19.999', '19,99', '', ' '])('rejects a malformed price (%p)', (price) => {
    expect(productFormSchema.safeParse({ ...VALID, price }).success).toBe(false);
  });

  it('accepts a price with no cents and a price with one decimal digit', () => {
    expect(productFormSchema.safeParse({ ...VALID, price: '20' }).success).toBe(true);
    expect(productFormSchema.safeParse({ ...VALID, price: '20.5' }).success).toBe(true);
  });

  it('rejects a price above the sanity ceiling', () => {
    expect(productFormSchema.safeParse({ ...VALID, price: '5000000' }).success).toBe(false);
  });

  it.each(['US', 'USDD', '123'])('rejects a malformed currency code (%p)', (currency) => {
    expect(productFormSchema.safeParse({ ...VALID, currency }).success).toBe(false);
  });

  it('rejects an unrecognised status', () => {
    expect(productFormSchema.safeParse({ ...VALID, status: 'DELETED' }).success).toBe(false);
  });
});

describe('centsToPriceInput / priceInputToCents', () => {
  it('round-trips whole and fractional amounts', () => {
    expect(centsToPriceInput(2499)).toBe('24.99');
    expect(priceInputToCents('24.99')).toBe(2499);
    expect(centsToPriceInput(2000)).toBe('20.00');
    expect(priceInputToCents('20')).toBe(2000);
  });
});
