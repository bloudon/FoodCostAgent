/**
 * Drop-in replacement for fetch() that checks for 401 responses and
 * invokes the shared unauthorized handler so the app redirects to login
 * when a session is revoked mid-count (e.g. Google token revoked).
 *
 * Usage:
 *   const { handleUnauthorized } = useAuth();
 *   const res = await fetchWithAuth(url, options, handleUnauthorized);
 *
 * The response is returned as-is so callers can still inspect res.ok,
 * res.status, etc.  The unauthorized handler is fire-and-forget from
 * the caller's perspective — it clears local credentials and navigates
 * to /login (with a reason parameter when reauthenticate:true is set).
 */

export type UnauthorizedHandler = (reauthenticate: boolean) => Promise<void>;

export async function fetchWithAuth(
  url: string,
  options: RequestInit,
  onUnauthorized: UnauthorizedHandler,
): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401) {
    let reauthenticate = false;
    try {
      // Clone so the body can still be read by the caller if needed.
      const body = (await res.clone().json()) as Record<string, unknown>;
      reauthenticate = body.reauthenticate === true;
    } catch {
      // Non-JSON 401 body — treat as a plain session expiry.
    }
    await onUnauthorized(reauthenticate);
  }
  return res;
}
