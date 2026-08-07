import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const AUTH_TOKEN_KEY = 'fnb_auth_token';

type AuthContextType = {
  token: string | null;
  setToken: (token: string | null) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadToken() {
      try {
        const stored = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
        if (stored) {
          setTokenState(stored);
        }
      } catch (err) {
        console.error('Failed to load token', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadToken();
  }, []);

  const setToken = async (newToken: string | null) => {
    setTokenState(newToken);
    if (newToken) {
      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, newToken);
    } else {
      await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
    }
  };

  const logout = async () => {
    await setToken(null);
  };

  return (
    <AuthContext.Provider value={{ token, setToken, logout, isLoading }}>
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
