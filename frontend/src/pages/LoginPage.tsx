import { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface LoginFormData {
  username: string;
  password: string;
}

interface RegisterFormData {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  full_name: string;
}

interface PasswordStrength {
  score: number; // 0-4
  label: string;
  color: string;
}

const calculatePasswordStrength = (password: string): PasswordStrength => {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  
  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'];
  
  return { score: Math.min(score, 4), label: labels[Math.min(score, 4)], color: colors[Math.min(score, 4)] };
};

export default function LoginPage() {
  const { login, register, isLoading, error } = useAuth();
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [loginForm, setLoginForm] = useState<LoginFormData>({
    username: '',
    password: '',
  });

  const [registerForm, setRegisterForm] = useState<RegisterFormData>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    full_name: '',
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength>({ score: 0, label: '', color: '#ef4444' });

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await login(loginForm);
      navigate('/dashboard');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (registerForm.password !== registerForm.confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }

    if (passwordStrength.score < 3) {
      setFormError('Password is too weak. Please use a stronger password.');
      return;
    }

    try {
      await register({
        username: registerForm.username,
        email: registerForm.email,
        password: registerForm.password,
        full_name: registerForm.full_name,
      });
      navigate('/dashboard');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  const handlePasswordChange = useCallback((value: string) => {
    setPasswordStrength(calculatePasswordStrength(value));
  }, []);

  const handleInputChange = <T extends LoginFormData | RegisterFormData>(
    e: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<T>>
  ) => {
    const { name, value } = e.target;
    setter(prev => ({ ...prev, [name]: value }));
    if (name === 'password') handlePasswordChange(value);
  };

  const handleModeSwitch = useCallback(() => {
    setIsRegister(prev => !prev);
    setFormError(null);
    setShowPassword(false);
    // Reset both forms when switching modes
    setLoginForm({ username: '', password: '' });
    setRegisterForm({ username: '', email: '', password: '', confirmPassword: '', full_name: '' });
    setPasswordStrength({ score: 0, label: '', color: '#ef4444' });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5 login-bg-pattern" aria-hidden="true" />

      {/* Corner accents */}
      <div className="absolute top-6 left-6 w-24 h-24 border-t-2 border-l-2 border-primary/30 rounded-tl-lg" />
      <div className="absolute top-6 right-6 w-24 h-24 border-t-2 border-r-2 border-primary/30 rounded-tr-lg" />
      <div className="absolute bottom-6 left-6 w-24 h-24 border-b-2 border-l-2 border-primary/30 rounded-bl-lg" />
      <div className="absolute bottom-6 right-6 w-24 h-24 border-b-2 border-r-2 border-primary/30 rounded-br-lg" />

      {/* Auth Card */}
      <div className="relative z-10 w-full max-w-md mx-4 animate-in">
        <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))] tracking-tight">
              {isRegister ? 'CREATE ACCOUNT' : 'BORDER COMMAND ACCESS'}
            </h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-2 text-sm">
              Intelligent Border Video Analytics Platform
            </p>
            <p className="text-[hsl(var(--muted-foreground))] mt-1 text-xs">
              IBVAP • SSB Tier-1 Operations
            </p>
          </div>

          {/* Error Display */}
          {(error || formError) && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-start gap-2 text-sm text-red-400">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{formError || error}</span>
              </div>
            </div>
          )}

          {/* Login Form */}
          {!isRegister && (
            <form onSubmit={handleLoginSubmit} className="space-y-5">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  value={loginForm.username}
                  onChange={(e) => handleInputChange(e, setLoginForm)}
                  required
                  autoComplete="username"
                  className="w-full px-4 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] transition-all"
                  placeholder="Enter your username"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={loginForm.password}
                    onChange={(e) => handleInputChange(e, setLoginForm)}
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] transition-all pr-12"
                    placeholder="Enter your password"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 bg-primary text-primary-foreground font-medium rounded-lg transition-all hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Authorizing...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <span>ACCESS COMMAND CENTER</span>
                    </>
                  )}
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
              </button>
            </form>
          )}

          {/* Register Form */}
          {isRegister && (
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Full Name
                </label>
                <input
                  id="full_name"
                  name="full_name"
                  type="text"
                  value={registerForm.full_name}
                  onChange={(e) => handleInputChange(e, setRegisterForm)}
                  required
                  autoComplete="name"
                  className="w-full px-4 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] transition-all"
                  placeholder="Enter your full name"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="reg_username" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Username
                </label>
                <input
                  id="reg_username"
                  name="username"
                  type="text"
                  value={registerForm.username}
                  onChange={(e) => handleInputChange(e, setRegisterForm)}
                  required
                  autoComplete="username"
                  className="w-full px-4 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] transition-all"
                  placeholder="Choose a username"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={registerForm.email}
                  onChange={(e) => handleInputChange(e, setRegisterForm)}
                  required
                  autoComplete="email"
                  className="w-full px-4 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] transition-all"
                  placeholder="Enter your email"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="reg_password" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="reg_password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={registerForm.password}
                    onChange={(e) => handleInputChange(e, setRegisterForm)}
                    required
                    autoComplete="new-password"
                    className="w-full px-4 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] transition-all pr-12"
                    placeholder="Create a password (min 8 chars)"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                {/* Password Strength Indicator */}
                {registerForm.password && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-[hsl(var(--border))] rounded-full overflow-hidden">
                      <div 
                        className="h-full transition-all duration-300"
                        style={{ 
                          width: `${Math.max((passwordStrength.score / 4) * 100, 10)}%`,
                          backgroundColor: passwordStrength.color,
                        }}
                      />
                    </div>
                    <p className="text-xs mt-1" style={{ color: passwordStrength.color }}>
                      Strength: {passwordStrength.label}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={registerForm.confirmPassword}
                  onChange={(e) => handleInputChange(e, setRegisterForm)}
                  required
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg text-[hsl(var(--foreground))] placeholder-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] transition-all"
                  placeholder="Confirm your password"
                  disabled={isLoading}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 bg-primary text-primary-foreground font-medium rounded-lg transition-all hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden group"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Creating Account...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                      </svg>
                      <span>CREATE ACCOUNT</span>
                    </>
                  )}
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-transparent to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
              </button>
            </form>
          )}

          {/* Switch Mode */}
          <div className="mt-6 text-center">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {isRegister ? 'Already have an account?' : 'Need an account?'}
              <button
                type="button"
                onClick={handleModeSwitch}
                className="ml-2 text-primary font-medium hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] rounded"
              >
                {isRegister ? 'Sign In' : 'Register'}
              </button>
            </p>
          </div>

          {/* Security Notice */}
          <div className="mt-6 p-3 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-lg">
            <div className="flex items-start gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                JWT Authentication • Passwords hashed with bcrypt • Tokens stored securely in localStorage
              </span>
            </div>
          </div>

          {/* Version */}
          <div className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
            <span>IBVAP v1.0.0</span>
            <span className="mx-2">•</span>
            <span>CLASSIFIED // OPERATIONAL</span>
          </div>
        </div>
      </div>
    </div>
  );
}