import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User } from '../types/detection';

const MOCK_USER: User = {
  name: 'Command Officer',
  role: 'SSB Tier-1',
  bopLocation: 'BOP-04 Alpha',
};

export default function LoginScreen() {
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 800)); // Simulate auth delay
    login(MOCK_USER);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5 login-bg-pattern" aria-hidden="true" />

      {/* Corner accents */}
      <div className="absolute top-6 left-6 w-24 h-24 border-t-2 border-l-2 border-primary/30 rounded-tl-lg" />
      <div className="absolute top-6 right-6 w-24 h-24 border-t-2 border-r-2 border-primary/30 rounded-tr-lg" />
      <div className="absolute bottom-6 left-6 w-24 h-24 border-b-2 border-l-2 border-primary/30 rounded-bl-lg" />
      <div className="absolute bottom-6 right-6 w-24 h-24 border-b-2 border-r-2 border-primary/30 rounded-br-lg" />

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md mx-4 animate-in">
        <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))] tracking-tight">BORDER COMMAND ACCESS</h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-2 text-sm">Intelligent Border Video Analytics Platform</p>
            <p className="text-[hsl(var(--muted-foreground))] mt-1 text-xs">IBVAP \u2022 SSB Tier-1 Operations</p>
          </div>

          {/* Credentials Display */}
          <button
            type="button"
            onClick={() => setShowCredentials(!showCredentials)}
            className="w-full mb-6 p-3 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-lg text-left transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))]"
            aria-expanded={showCredentials}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Demo Credentials</span>
              <svg className={`w-4 h-4 text-[hsl(var(--muted-foreground))] transition-transform ${showCredentials ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {showCredentials && (
              <div className="mt-3 space-y-2 text-sm font-mono text-[hsl(var(--foreground))]">
                <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Name:</span> <span>{MOCK_USER.name}</span></div>
                <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Role:</span> <span>{MOCK_USER.role}</span></div>
                <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">BOP:</span> <span>{MOCK_USER.bopLocation}</span></div>
              </div>
            )}
          </button>

          {/* Login Button */}
          <button
            onClick={handleLogin}
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

          {/* Security Notice */}
          <div className="mt-6 p-3 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-lg">
            <div className="flex items-start gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>DEMO MODE: Mock authentication \u2022 No backend calls \u2022 Session persists in localStorage</span>
            </div>
          </div>

          {/* Version */}
          <div className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
            <span>IBVAP v1.0.0-SIH-DEMO</span>
            <span className="mx-2">\u2022</span>
            <span>CLASSIFIED // OPERATIONAL</span>
          </div>
        </div>
      </div>
    </div>
  );
}