import { formatMoney } from './Money';

describe('formatMoney', () => {
  it('formats cents as a currency string using the given ISO code', () => {
    expect(formatMoney(2499, 'USD')).toBe('$24.99');
  });

  it('handles zero', () => {
    expect(formatMoney(0, 'USD')).toBe('$0.00');
  });

  it('falls back to a plain decimal when Intl rejects the currency code', () => {
    expect(formatMoney(1050, 'NOT_A_CURRENCY')).toBe('10.50 NOT_A_CURRENCY');
  });
});
