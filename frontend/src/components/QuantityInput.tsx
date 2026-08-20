export interface QuantityInputProps {
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
  'aria-label': string;
}

/** A reusable stepper used on both the product detail page and cart lines. */
export function QuantityInput({
  value,
  min = 1,
  max,
  disabled = false,
  onChange,
  'aria-label': ariaLabel,
}: QuantityInputProps) {
  const clamp = (next: number): number => {
    let clamped = Number.isFinite(next) ? Math.trunc(next) : min;
    clamped = Math.max(min, clamped);
    if (max !== undefined) {
      clamped = Math.min(max, clamped);
    }
    return clamped;
  };

  return (
    <div className="quantity-stepper">
      <button
        type="button"
        aria-label={`Decrease ${ariaLabel}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          onChange(clamp(Number.isNaN(parsed) ? min : parsed));
        }}
      />
      <button
        type="button"
        aria-label={`Increase ${ariaLabel}`}
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </button>
    </div>
  );
}
