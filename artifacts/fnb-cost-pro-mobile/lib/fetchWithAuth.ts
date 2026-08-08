/**
 * fetchWithAuth
 *
 * A thin wrapper around fetch() for screens that make authenticated API
 * calls directly (scan, count, etc.) outside the generated
 * @workspace/api-client-react client.
 *
 * The caller is responsible for fetching the token and including it in
 * `options.headers`; this function focuses solely on inspecting 401
 * responses and triggering the session-expired redirect when the server
 * signals `reauthenticate: true`.
 *
 * Usage
 * -----
 * ```ts
 * const { getToken, handleUnauthorized } = useAuth();
 * const token = await getToken();
 * const res = await fetchWithAuth(
 *   url,
 *   {
 *     method: "PATCH",
 *     headers: {
 *       "Content-Type": "application/json",
 *       ...(token ? { Authorization: `Bearer ${token}` } : {}),
 *     },
 *     body: JSON.stringify(payload),
 *   },
 *   handleUnauthorized,
 * );
 * if (res.ok) { ... }   // 401 already handled — screen is navigating away
 * ```
 *
 * The raw Response is always returned so callers can still inspect
 * res.ok / res.status.  After a 401 the screen will normally be navigating
 * away, so any subsequent error-display branch is a no-op.
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit,
  handleUnauthorized: (reauthenticate: boolean) => Promise<void>
): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 401) {
    let reauthenticate = false;
    try {
      const body = (await res.clone().json()) as Record<string, unknown>;
      reauthenticate = body.reauthenticate === true;
    } catch {
      // Non-JSON 401 body — treat as plain expired session.
    }
    await handleUnauthorized(reauthenticate);
  }

  return res;
}
