import { LoginForm } from '../features/auth/LoginForm';

export function LoginPage() {
  return (
    <div className="page-container auth-page">
      <div className="card auth-card">
        <h1>Log in</h1>
        <LoginForm />
      </div>
    </div>
  );
}
