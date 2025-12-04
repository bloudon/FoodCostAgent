import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

// Extended user type with selectedCompanyId from session
type AuthUser = User & {
  selectedCompanyId?: string | null;
};

type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  getEffectiveCompanyId: () => string | null;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const response = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await response.json();
    setUser(data.user);
  }

  async function logout() {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      queryClient.clear();
    }
  }

  // Refresh auth state - useful after signup when session cookie is set but context is stale
  async function refreshAuth() {
    await checkAuth();
  }

  // Helper function to get the effective company ID
  // For global admins, use selectedCompanyId from session
  // For company-bound users, use their companyId
  function getEffectiveCompanyId(): string | null {
    if (!user) return null;
    return user.role === "global_admin" 
      ? (user.selectedCompanyId || null) 
      : (user.companyId || null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshAuth, getEffectiveCompanyId }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
