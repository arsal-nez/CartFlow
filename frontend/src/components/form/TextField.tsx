import type { UseFormRegisterReturn } from 'react-hook-form';

export interface TextFieldProps {
  label: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string | undefined;
  hint?: string | undefined;
  registration: UseFormRegisterReturn;
}

/** Reusable Zod/React-Hook-Form-bound input with label and error message. */
export function TextField({
  label,
  type = 'text',
  placeholder,
  autoComplete,
  error,
  hint,
  registration,
}: TextFieldProps) {
  const inputId = `field-${registration.name}`;
  const errorId = `${inputId}-error`;

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
        {...registration}
      />
      {error !== undefined && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
      {error === undefined && hint !== undefined && <span className="field-hint">{hint}</span>}
    </div>
  );
}
