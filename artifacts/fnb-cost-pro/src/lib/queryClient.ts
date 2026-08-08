import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getMobileToken } from "@/hooks/use-embedded";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = `${res.status}: ${text}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) {
        message = parsed.error;
      }
      // When the server signals that re-authentication is required (e.g. a
      // Google token was revoked), redirect the user to the login page
      // with a reason parameter so they see an informative message.
      if (res.status === 401 && parsed.reauthenticate === true) {
        window.location.href = "/login?reason=session_expired";
        return; // page is being replaced; no need to throw
      }
    } catch (_e) {
      // Not JSON — use the raw text fallback
    }
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const mobileToken = getMobileToken();
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  if (mobileToken) {
    headers["Authorization"] = `Bearer ${mobileToken}`;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const mobileToken = getMobileToken();
    const headers: Record<string, string> = {};
    if (mobileToken) {
      headers["Authorization"] = `Bearer ${mobileToken}`;
    }
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      // Even in returnNull mode, a reauthenticate:true response means the
      // session is permanently invalidated — redirect to login with context.
      try {
        const text = await res.text();
        const parsed = JSON.parse(text);
        if (parsed.reauthenticate === true) {
          window.location.href = "/login?reason=session_expired";
        }
      } catch {
        // Body unreadable or not JSON — fall through and return null
      }
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
