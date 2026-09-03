import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { User, AuthState } from '../types/detection';
import { apiPost } from '../api/client';

interface RegisterData {
  username: string;
  email: string;
  password: string;
  full_name?: string;
}

interface LoginCredentials {
  username: string;
  password: string;
}

interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    user_id: string;
    username: string;
    email: string;
    full_name: string | null;
    role?: string;
    bop_location?: string;
  };
}

interface RegisterResponse {
  user_id: string;
  username: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

interface AuthContextType extends AuthState {}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'ibvap_token';
const USER_KEY = 'ibvap_user';
const DEV_USER: User = {
  name: 'Local Operator',
  email: 'local@ibvap.dev',
  role: 'Operator',
  bopLocation: 'BOP-01',
};

function parseJwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const expiry = parseJwtExpiry(token);
  if (!expiry) return true;
  return Date.now() >= expiry;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const hydrate = () => {
      if (import.meta.env.DEV) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setUser(DEV_USER);
        setIsAuthenticated(true);
        setHydrated(true);
        return;
      }

      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);
      
      if (storedToken && storedUser) {
        if (isTokenExpired(storedToken)) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setHydrated(true);
          return;
        }
        try {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setIsAuthenticated(true);
        } catch {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      }
      setHydrated(true);
    };

    hydrate();

    // Listen for storage changes from other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY || e.key === USER_KEY) {
        hydrate();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const setAuthData = useCallback((token: string, userData: User) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setUser(userData);
    setIsAuthenticated(true);
    setError(null);
  }, []);

  const clearAuthData = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;

    const expiry = parseJwtExpiry(storedToken);
    if (!expiry) return;

    const timeout = window.setTimeout(() => {
      clearAuthData();
    }, Math.max(0, expiry - Date.now()));

    return () => window.clearTimeout(timeout);
  }, [isAuthenticated, clearAuthData]);

  const register = useCallback(async (data: RegisterData) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiPost<RegisterResponse>('/api/auth/register', data);
      // After registration, auto-login
      const loginResponse = await apiPost<AuthResponse>('/api/auth/login', {
        username: data.username,
        password: data.password
      });
      const userData: User = {
        name: loginResponse.user.full_name || loginResponse.user.username,
        email: loginResponse.user.email,
        role: loginResponse.user.role || 'Operator',
        bopLocation: loginResponse.user.bop_location || 'BOP-01',
      };
      setAuthData(loginResponse.access_token, userData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [setAuthData]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiPost<AuthResponse>('/api/auth/login', credentials);
      const userData: User = {
        name: response.user.full_name || response.user.username,
        email: response.user.email,
        role: response.user.role || 'Operator',
        bopLocation: response.user.bop_location || 'BOP-01',
      };
      setAuthData(response.access_token, userData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [setAuthData]);

  const logout = useCallback(() => {
    clearAuthData();
  }, [clearAuthData]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      login, 
      logout, 
      register,
      isLoading, 
      error,
      hydrated
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}