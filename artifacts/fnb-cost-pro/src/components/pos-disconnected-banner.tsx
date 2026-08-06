/**
 * PosDisconnectedBanner
 *
 * Shown in the app shell whenever the current company has at least one Square
 * POS connection in the "disconnected" state (e.g. after a token-refresh
 * failure).  Only company_admin and global_admin users see it.
 *
 * The banner is dismissible for the current browser session (useState).
 * It links to /settings so the admin can reconnect from the Square section.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

interface PosConnection {
  id: string;
  status: string;
  provider: string;
  merchantId?: string | null;
}

export function PosDisconnectedBanner() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(false);

  // Only company admins and global admins need to see / act on this.
  const canSee =
    user?.role === "company_admin" || user?.role === "global_admin";

  // Avoid fetching or rendering on the settings page — the per-connection
  // alert there already surfaced the disconnect with a "Reconnect" button.
  const onSettingsPage = location === "/settings" || location.startsWith("/settings/");

  const { data: connections } = useQuery<PosConnection[]>({
    queryKey: ["/api/pos/connections"],
    enabled: canSee && !dismissed && !onSettingsPage,
    staleTime: 60_000, // re-check at most once per minute
    refetchOnWindowFocus: true,
  });

  const disconnected = (connections ?? []).filter((c) => c.status === "disconnected");

  if (!canSee || dismissed || onSettingsPage || disconnected.length === 0) {
    return null;
  }

  const count = disconnected.length;
  const label =
    count === 1
      ? "Your Square POS connection was disconnected — nightly syncs are paused."
      : `${count} Square POS connections were disconnected — nightly syncs are paused.`;

  return (
    <div
      className="shrink-0 flex items-center gap-3 px-4 py-2 bg-destructive/10 border-b border-destructive/30 text-sm"
      data-testid="pos-disconnected-banner"
      role="alert"
    >
      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
      <span className="flex-1 text-foreground">
        <span className="font-medium text-destructive">Square disconnected. </span>
        {label}{" "}
        <button
          type="button"
          className="underline underline-offset-2 text-destructive hover:text-destructive/80 transition-colors font-medium"
          onClick={() => navigate("/settings")}
          data-testid="button-pos-disconnected-go-settings"
        >
          Go to Settings to reconnect.
        </button>
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="shrink-0 hover:bg-destructive/10"
        onClick={() => setDismissed(true)}
        data-testid="button-pos-disconnected-dismiss"
        aria-label="Dismiss Square disconnection alert"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
