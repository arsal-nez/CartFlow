export interface MoneyProps {
  cents: number;
  currency: string;
}

/** Formats a cents integer + ISO currency code using the browser's Intl support — never a hard-coded "$". */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function Money({ cents, currency }: MoneyProps) {
  return <>{formatMoney(cents, currency)}</>;
}
