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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);
    
    if (storedToken && storedUser) {
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
        name: response.full_name || response.username,
        role: 'Operator',
        bopLocation: 'BOP-01',
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
        role: 'Operator',
        bopLocation: 'BOP-01',
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