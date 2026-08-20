import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useAuth } from '../../auth/AuthContext';
import { InlineError } from '../../components/feedback/ErrorState';
import { TextField } from '../../components/form/TextField';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type LoginValues = z.infer<typeof loginSchema>;

interface RouterLocationState {
  from?: { pathname: string };
}

export function LoginForm() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<unknown>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await signIn(values.email, values.password);
      const state = location.state as RouterLocationState | null;
      navigate(state?.from?.pathname ?? '/', { replace: true });
    } catch (error) {
      setSubmitError(error);
    }
  });

  return (
    <form className="form" onSubmit={(event) => void onSubmit(event)} noValidate>
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        registration={register('email')}
        error={errors.email?.message}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        registration={register('password')}
        error={errors.password?.message}
      />
      {submitError !== null && <InlineError error={submitError} />}
      <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Log in'}
      </button>
      <p className="auth-card__footer">
        Don&apos;t have an account? <Link to="/register">Sign up</Link>
      </p>
    </form>
  );
}
