import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useAuth } from '../../auth/AuthContext';
import { InlineError } from '../../components/feedback/ErrorState';
import { TextField } from '../../components/form/TextField';

/** Mirrors the Cognito user pool's `PasswordPolicy` in `serverless.yml` exactly (`RequireSymbols: false`). */
const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number');

const registerSchema = z
  .object({
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type RegisterValues = z.infer<typeof registerSchema>;

const confirmationSchema = z.object({
  code: z.string().trim().min(1, 'Enter the confirmation code sent to your email'),
});
type ConfirmationValues = z.infer<typeof confirmationSchema>;

interface PendingAccount {
  email: string;
  password: string;
}

export function RegisterForm() {
  const { signUp, confirmSignUp, resendConfirmationCode, signIn } = useAuth();
  const navigate = useNavigate();
  const [pendingAccount, setPendingAccount] = useState<PendingAccount | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const registerForm = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });
  const confirmForm = useForm<ConfirmationValues>({ resolver: zodResolver(confirmationSchema) });

  const onRegister = registerForm.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const result = await signUp(values.email, values.password);
      if (result.userConfirmed) {
        await signIn(values.email, values.password);
        navigate('/', { replace: true });
        return;
      }
      setPendingAccount({ email: values.email, password: values.password });
    } catch (error) {
      setSubmitError(error);
    }
  });

  const onConfirm = confirmForm.handleSubmit(async (values) => {
    if (pendingAccount === null) {
      return;
    }
    setSubmitError(null);
    try {
      await confirmSignUp(pendingAccount.email, values.code);
      await signIn(pendingAccount.email, pendingAccount.password);
      navigate('/', { replace: true });
    } catch (error) {
      setSubmitError(error);
    }
  });

  const handleResend = async () => {
    if (pendingAccount === null) {
      return;
    }
    setResendState('sending');
    setSubmitError(null);
    try {
      await resendConfirmationCode(pendingAccount.email);
      setResendState('sent');
    } catch (error) {
      setSubmitError(error);
      setResendState('idle');
    }
  };

  if (pendingAccount !== null) {
    return (
      <form className="form" onSubmit={(event) => void onConfirm(event)} noValidate>
        <p>
          We sent a confirmation code to <strong>{pendingAccount.email}</strong>.
        </p>
        <TextField
          label="Confirmation code"
          autoComplete="one-time-code"
          registration={confirmForm.register('code')}
          error={confirmForm.formState.errors.code?.message}
        />
        {submitError !== null && <InlineError error={submitError} />}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={confirmForm.formState.isSubmitting}
        >
          {confirmForm.formState.isSubmitting ? 'Confirming…' : 'Confirm account'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => void handleResend()}
          disabled={resendState === 'sending'}
        >
          {resendState === 'sent' ? 'Code resent' : 'Resend code'}
        </button>
      </form>
    );
  }

  return (
    <form className="form" onSubmit={(event) => void onRegister(event)} noValidate>
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        registration={registerForm.register('email')}
        error={registerForm.formState.errors.email?.message}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        registration={registerForm.register('password')}
        error={registerForm.formState.errors.password?.message}
        hint="At least 12 characters, with uppercase, lowercase, and a number."
      />
      <TextField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        registration={registerForm.register('confirmPassword')}
        error={registerForm.formState.errors.confirmPassword?.message}
      />
      {submitError !== null && <InlineError error={submitError} />}
      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={registerForm.formState.isSubmitting}
      >
        {registerForm.formState.isSubmitting ? 'Creating account…' : 'Sign up'}
      </button>
      <p className="auth-card__footer">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}
