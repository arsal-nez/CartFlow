import { RegisterForm } from '../features/auth/RegisterForm';

export function RegisterPage() {
  return (
    <div className="page-container auth-page">
      <div className="card auth-card">
        <h1>Create your account</h1>
        <RegisterForm />
      </div>
    </div>
  );
}
