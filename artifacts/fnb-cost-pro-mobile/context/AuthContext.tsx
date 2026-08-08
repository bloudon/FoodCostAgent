import * as SecureStore from "expo-secure-store";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import { setAuthTokenGetter, setUnauthorizedHandler } from "@workspace/api-client-react";
import i18n from "@/i18n";

const TOKEN_KEY = "fnb_auth_token";
const USER_KEY = "fnb_auth_user";
const LANG_KEY = "fnb_language";

const PROD_BASE = "https://app.fnbcostpro.com";

// On native dev builds we talk to the local Replit API server instead of
// production, so testers can exercise the full voice-waste pipeline without
// needing a production account or deployed endpoints.
function getAuthBase(): string {
  if (__DEV__ && Platform.OS !== "web") {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (domain) return `https://${domain}/api`;
  }
  return PROD_BASE;
}
const AUTH_BASE = getAuthBase();

export interface AuthUser {
  email: string;
  name?: string;
  userId?: string;
  companyId?: string;
  role?: string;
  preferredLanguage?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  language: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
  updateName: (name: string) => Promise<void>;
  setLanguage: (lang: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function decodeJwtName(token: string): string | undefined {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return undefined;
    const padded = payloadB64 + "==".slice((payloadB64.length % 4) || 4);
    const json = JSON.parse(atob(padded)) as Record<string, unknown>;
    const candidate =
      (typeof json.name === "string" && json.name) ||
      (typeof json.given_name === "string" && json.given_name) ||
      (typeof json.display_name === "string" && json.display_name) ||
      (typeof json.displayName === "string" && json.displayName);
    return candidate || undefined;
  } catch {
    return undefined;
  }
}

function extractName(data: Record<string, unknown>, token: string): string | undefined {
  const user = data.user as Record<string, unknown> | undefined;
  return (
    (typeof data.name === "string" && data.name) ||
    (typeof data.displayName === "string" && data.displayName) ||
    (typeof data.display_name === "string" && data.display_name) ||
    (typeof data.first_name === "string" && data.first_name) ||
    (typeof data.firstName === "string" && data.firstName) ||
    (typeof user?.name === "string" && user.name) ||
    (typeof user?.displayName === "string" && (user.displayName as string)) ||
    decodeJwtName(token) ||
    undefined
  );
}

async function fetchPreferredLanguage(authToken: string): Promise<string | null> {
  // Dev API tokens aren't valid on the production auth endpoint; skip.
  if (AUTH_BASE !== PROD_BASE) return null;
  try {
    const res = await fetch(`${PROD_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const lang =
      typeof data.preferredLanguage === "string"
        ? data.preferredLanguage
        : typeof (data.user as Record<string, unknown> | undefined)?.preferredLanguage === "string"
        ? ((data.user as Record<string, unknown>).preferredLanguage as string)
        : null;
    if (lang === "en" || lang === "es") return lang;
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [language, setLanguageState] = useState<string>("en");

  useEffect(() => {
    async function hydrate() {
      try {
        const [storedToken, storedUser, storedLang] = await Promise.all([
          secureGet(TOKEN_KEY),
          secureGet(USER_KEY),
          secureGet(LANG_KEY),
        ]);
        if (storedToken && storedUser) {
          setToken(storedToken);
          const parsedUser = JSON.parse(storedUser) as AuthUser;
          setUser(parsedUser);
          const lang = storedLang ?? parsedUser.preferredLanguage ?? "en";
          if (lang === "en" || lang === "es") {
            setLanguageState(lang);
            i18n.changeLanguage(lang);
          }
        }
      } catch {
        // If hydration fails we stay logged out
      } finally {
        setIsLoading(false);
      }
    }
    hydrate();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // In native dev mode AUTH_BASE points to the local Replit API server;
    // that server exposes /mobile/dev-login (any password accepted, auto-seeds data).
    const loginPath =
      AUTH_BASE !== PROD_BASE ? "/mobile/dev-login" : "/api/mobile/login";
    const response = await fetch(`${AUTH_BASE}${loginPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      let message = "Invalid email or password.";
      try {
        const data = await response.json() as Record<string, unknown>;
        if (typeof data.message === "string" && data.message) {
          message = data.message;
        } else if (typeof data.error === "string" && data.error) {
          message = data.error;
        }
      } catch {
        // ignore parse errors
      }
      throw new Error(message);
    }

    const data = await response.json() as Record<string, unknown>;

    const authToken =
      typeof data.token === "string"
        ? data.token
        : typeof data.access_token === "string"
        ? data.access_token
        : null;

    if (!authToken) {
      throw new Error("No auth token received from server.");
    }

    const nested = data.user as Record<string, unknown> | undefined;

    const authUser: AuthUser = {
      email:
        (typeof data.email === "string" && data.email) ||
        (typeof nested?.email === "string" && nested.email) ||
        email,
      name: extractName(data, authToken),
      userId:
        (typeof data.userId === "string" ? data.userId : undefined) ??
        (typeof data.id === "string" ? data.id : undefined) ??
        (typeof nested?.id === "string" ? nested.id : undefined) ??
        (typeof nested?.userId === "string" ? nested.userId : undefined),
      companyId:
        (typeof data.companyId === "string" ? data.companyId : undefined) ??
        (typeof nested?.companyId === "string" ? nested.companyId : undefined),
      role:
        (typeof data.role === "string" ? data.role : undefined) ??
        (typeof nested?.role === "string" ? nested.role : undefined),
    };

    await Promise.all([
      secureSet(TOKEN_KEY, authToken),
      secureSet(USER_KEY, JSON.stringify(authUser)),
    ]);

    setToken(authToken);
    setUser(authUser);

    // Fetch preferred language from /api/auth/me (fire after login)
    const preferredLang = await fetchPreferredLanguage(authToken);
    if (preferredLang) {
      setLanguageState(preferredLang);
      i18n.changeLanguage(preferredLang);
      await secureSet(LANG_KEY, preferredLang);
      authUser.preferredLanguage = preferredLang;
      secureSet(USER_KEY, JSON.stringify(authUser)).catch(() => {});
    }
  }, []);

  const setLanguage = useCallback(async (lang: string) => {
    setLanguageState(lang);
    i18n.changeLanguage(lang);
    await secureSet(LANG_KEY, lang);
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, preferredLanguage: lang };
      secureSet(USER_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    // Fire-and-forget PATCH to production
    secureGet(TOKEN_KEY).then((tok) => {
      if (!tok) return;
      fetch(`${PROD_BASE}/api/auth/me/language`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
        },
        body: JSON.stringify({ language: lang }),
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  const updateName = useCallback(async (name: string) => {
    setUser((prev) => {
      if (!prev) return prev;
      if (prev.name === name) return prev;
      const updated = { ...prev, name };
      secureSet(USER_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const logout = useCallback(async () => {
    await Promise.all([secureDelete(TOKEN_KEY), secureDelete(USER_KEY)]);
    setToken(null);
    setUser(null);
    // AuthGate in app/_layout.tsx observes `user` and redirects to /login automatically.
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (token) return token;
    return secureGet(TOKEN_KEY);
  }, [token]);

  useEffect(() => {
    setAuthTokenGetter(() => secureGet(TOKEN_KEY));
    return () => {
      setAuthTokenGetter(null);
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(async (data?: unknown) => {
      await Promise.all([secureDelete(TOKEN_KEY), secureDelete(USER_KEY)]);
      setToken(null);
      setUser(null);
      // When the server explicitly signals re-authentication is required
      // (e.g. Google token was revoked), navigate directly with a reason
      // parameter so the login screen can show an informative message.
      const needsReauth =
        data !== null &&
        typeof data === "object" &&
        (data as Record<string, unknown>).reauthenticate === true;
      if (needsReauth) {
        router.replace("/login?reason=session_expired" as never);
      }
      // For other 401s, AuthGate handles redirect to /login automatically
      // when user becomes null.
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, language, login, logout, getToken, updateName, setLanguage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
