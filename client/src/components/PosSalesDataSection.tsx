/**
 * PosSalesDataSection
 *
 * Unified "POS & Sales Data" settings section.
 * Replaces the standalone POS Provider dropdown (Company tab) and the
 * SquarePosCard (Data Connections tab) with one cohesive configuration block.
 *
 * Behaviours:
 *  - Provider list populated from GET /api/pos/providers (server registry)
 *  - Method selector reveals electronic-connect vs manual-upload options
 *    based on the selected provider's availability
 *  - Provider + method saved atomically via a single PATCH
 *  - "Connect" saves first then redirects to OAuth (save-before-OAuth gate)
 *  - Provider change while a retained connection exists → blocking dialog
 *  - Method change from pos_connector → manual_upload → inline retention note
 *  - Connector status driven by GET /api/pos/setup-status (counts, sync times)
 *  - All existing Square sync / backfill / disconnect / mapping actions preserved
 */
import { useState, useEffect } from "react";
import { useLocation as useWouterLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Zap, Link as LinkIcon, CheckCircle2, XCircle, Loader2, AlertCircle,
  RefreshCw, TriangleAlert, Info, MapPin, Package, Clock,
  ArrowRight, Upload,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Company } from "@shared/schema";

// ── API shapes ────────────────────────────────────────────────────────────────

interface PosProviderMeta {
  providerKey: string;
  displayName: string;
  availability: "available" | "manual_only" | "coming_later";
  capabilities: {
    oauth: boolean;
    salesRetrieval: boolean;
    locationMapping: boolean;
    itemMapping: boolean;
    backfill: boolean;
  };
}

interface PosSetupStatus {
  providerSelected: boolean;
  primaryMethodSelected: boolean;
  connectorAvailable: boolean;
  connectionStatus:
    | "not_configured"
    | "not_connected"
    | "connected"
    | "disconnected"
    | "error";
  locations: { total: number; mapped: number; ignored: number; unresolved: number };
  items: { total: number; mapped: number; ignored: number; unresolved: number };
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  latestSyncStatus: string | null;
  warningCount: number;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  selectedCompanyId: string | null;
  company: Company | undefined;
  onDirtyChange?: (dirty: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PosSalesDataSection({ selectedCompanyId, company, onDirtyChange }: Props) {
  const { toast } = useToast();
  const [location] = useWouterLocation();

  // ── Local edit state ───────────────────────────────────────────────────────
  const [localProvider, setLocalProvider] = useState<string>("none");
  const [localMethod, setLocalMethod] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [methodChangeNote, setMethodChangeNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Provider-change guard dialog
  const [showBlockedDialog, setShowBlockedDialog] = useState(false);

  // Sync / details state (preserved from original SquarePosCard)
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);

  // ── Sync from server data ──────────────────────────────────────────────────
  useEffect(() => {
    const provider = company?.posProvider ?? "none";
    const method = (company as any)?.primarySalesMethod ?? null;
    setLocalProvider(provider);
    setLocalMethod(method);
    setIsDirty(false);
    setMethodChangeNote(null);
    setSaveError(null);
  }, [company?.posProvider, (company as any)?.primarySalesMethod]);

  // ── Notify parent of dirty state ───────────────────────────────────────────
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // ── OAuth return-code handler ──────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const reconnected = params.get("pos_reconnected");
    const posError = params.get("pos_error");

    if (reconnected === "1") {
      toast({
        title: "Square reconnected",
        description: "Your connection is active again. You can run a sync now.",
      });
      params.delete("pos_reconnected");
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?${params.toString()}`,
      );
      return;
    }

    if (posError) {
      const messages: Record<string, { title: string; description: string }> = {
        merchant_mismatch: {
          title: "Different Square account",
          description:
            "The account that authorized is not the same merchant as this connection. Existing connection unchanged.",
        },
        state_replayed: {
          title: "Link already used",
          description:
            "This reconnect link was already used or expired. Start a fresh reconnect from the connection card.",
        },
        state_expired: {
          title: "Reconnect link expired",
          description:
            "The reconnect session expired (60 min limit). Please try again.",
        },
        access_denied: {
          title: "Square access denied",
          description:
            "You cancelled the Square authorization. No changes were made.",
        },
        connection_already_exists: {
          title: "Connection already exists",
          description:
            "A connection already exists for this account. Disconnect it first to start a new one.",
        },
      };
      const msg = messages[posError] ?? {
        title: "Square connection error",
        description:
          "Something went wrong during authorization. Please try reconnecting from the connection card.",
      };
      toast({ ...msg, variant: "destructive" });
      params.delete("pos_error");
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?${params.toString()}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // ── Data queries ───────────────────────────────────────────────────────────

  const { data: providers = [] } = useQuery<PosProviderMeta[]>({
    queryKey: ["/api/pos/providers"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: setupStatus } = useQuery<PosSetupStatus>({
    queryKey: ["/api/pos/setup-status"],
    enabled: !!selectedCompanyId,
    refetchInterval: pollingId ? 3000 : false,
  });

  const { data: connections = [], isLoading: connectionsLoading } = useQuery<any[]>({
    queryKey: ["/api/pos/connections"],
    enabled: !!selectedCompanyId,
  });

  const { data: syncJobs = [] } = useQuery<any[]>({
    queryKey: expandedId
      ? [`/api/pos/connections/${expandedId}/sync-jobs`]
      : [],
    enabled: !!expandedId,
    retry: false,
  });

  const { data: polledJobs = [] } = useQuery<any[]>({
    queryKey: pollingId
      ? [`/api/pos/connections/${pollingId}/sync-jobs`]
      : [],
    enabled: !!pollingId,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data as any[] | undefined;
      return data?.[0]?.status === "running" ? 3000 : false;
    },
  });

  // ── Polling side-effect ────────────────────────────────────────────────────
  useEffect(() => {
    if (!pollingId) return;
    if (polledJobs.length > 0 && polledJobs[0].status !== "running") {
      setSyncingId(null);
      setPollingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/pos/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/setup-status"] });
      if (expandedId === pollingId) {
        queryClient.invalidateQueries({
          queryKey: [`/api/pos/connections/${pollingId}/sync-jobs`],
        });
      }
    }
  }, [polledJobs, pollingId, expandedId]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const selectedProviderMeta = providers.find(
    (p) => p.providerKey === localProvider,
  );
  const supportsElectronic =
    selectedProviderMeta?.availability === "available" &&
    !!selectedProviderMeta.capabilities.salesRetrieval;

  const isManualOnlyProvider =
    selectedProviderMeta?.availability === "manual_only" ||
    selectedProviderMeta?.availability === "coming_later";

  // A "retained" connection is one that is not in the released terminal state.
  // Released = explicitly disconnected by the user (allows provider change).
  const conn = connections.find((c: any) => c.status !== "released") ?? null;

  const hasRetainedConnection =
    !!conn &&
    (conn.status === "active" ||
      conn.status === "disconnected" ||
      conn.status === "error");

  const isJobRunning = (connId: string) =>
    connId === pollingId && polledJobs[0]?.status === "running";

  // Show connector section when:
  //   (a) there is a retained connection in the DB, OR
  //   (b) user has set provider=electronic + method=pos_connector (intent to connect)
  const showConnectorSection =
    hasRetainedConnection ||
    (supportsElectronic && localMethod === "pos_connector");

  // Show manual section when:
  //   (a) selected provider is manual-only/coming-later, OR
  //   (b) method is manual_upload
  const showManualSection =
    isManualOnlyProvider || localMethod === "manual_upload";

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      posProvider: string;
      primarySalesMethod: string | null;
    }) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      const res = await fetch(`/api/companies/${selectedCompanyId}/pos-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          posProvider:
            payload.posProvider === "none" ? null : payload.posProvider,
          primarySalesMethod: payload.primarySalesMethod,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(
          (data as any).error || `Save failed (${res.status})`,
        );
        (err as any).status = res.status;
        (err as any).code = (data as any).code;
        throw err;
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${selectedCompanyId}`],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/setup-status"] });
      setIsDirty(false);
      setSaveError(null);
      setMethodChangeNote(null);
      toast({
        title: "Saved",
        description: "POS & sales data configuration updated.",
      });
    },
    onError: (err: any) => {
      if (err.status === 409 && err.code === "retained_pos_connection") {
        // Backend confirmed a retained connection blocks the provider change
        setSaveError(null);
        setShowBlockedDialog(true);
        return;
      }
      setSaveError(err.message || "Failed to save. Please try again.");
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/pos/connections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/setup-status"] });
      toast({ title: "Disconnected", description: "Square connection removed." });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleProviderChange = (newProvider: string) => {
    // Block provider switch while a retained connection exists
    if (hasRetainedConnection && newProvider !== localProvider) {
      setShowBlockedDialog(true);
      return; // keep selector at current value — don't apply the change
    }
    setLocalProvider(newProvider);
    // Auto-set method to match provider capabilities
    const meta = providers.find((p) => p.providerKey === newProvider);
    if (!meta || newProvider === "none") {
      setLocalMethod(null);
    } else if (meta.availability !== "available") {
      setLocalMethod("manual_upload");
    }
    // Keep current method if it's still valid for the new provider
    setIsDirty(true);
    setMethodChangeNote(null);
    setSaveError(null);
  };

  const handleMethodChange = (newMethod: string) => {
    const wasElectronic = localMethod === "pos_connector";
    setLocalMethod(newMethod);
    setIsDirty(true);
    setSaveError(null);
    if (wasElectronic && newMethod === "manual_upload") {
      setMethodChangeNote(
        "Automatic Square synchronization will stop. Your connection, mappings, and historical sales data will be retained. You can switch back to Connected POS at any time.",
      );
    } else {
      setMethodChangeNote(null);
    }
  };

  const handleSave = () => {
    setSaveError(null);
    saveMutation.mutate({
      posProvider: localProvider,
      primarySalesMethod: localMethod,
    });
  };

  /** Save provider+method first, then redirect to OAuth. */
  const handleConnectClick = async () => {
    setSaveError(null);
    try {
      const res = await fetch(`/api/companies/${selectedCompanyId}/pos-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          posProvider:
            localProvider === "none" ? null : localProvider,
          primarySalesMethod: localMethod ?? "pos_connector",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && (data as any).code === "retained_pos_connection") {
          setSaveError(null);
          setShowBlockedDialog(true);
          return;
        }
        setSaveError(
          (data as any).error ||
            `Could not save configuration before connecting (${res.status})`,
        );
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: [`/api/companies/${selectedCompanyId}`],
      });
      window.location.href = "/api/pos/connect/square";
    } catch (err: any) {
      setSaveError(err.message || "Failed to initiate connection.");
    }
  };

  const syncNow = async (
    id: string,
    type: "incremental" | "backfill" = "incremental",
  ) => {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/pos/connections/${id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type }),
      });
      if (res.status === 409) {
        setPollingId(id);
        toast({
          title: "Sync already in progress",
          description: "A sync job is already running for this connection.",
        });
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as any).error || `Sync request failed (${res.status})`,
        );
      }
      setPollingId(id);
      toast({
        title: "Sync started",
        description: "Sales data is being imported in the background.",
      });
    } catch (err: any) {
      toast({
        title: "Sync failed",
        description: err.message,
        variant: "destructive",
      });
      setSyncingId(null);
    }
  };

  // ── Small UI helpers ───────────────────────────────────────────────────────

  const jobStatusBadge = (status: string) => {
    if (status === "completed")
      return (
        <Badge
          variant="outline"
          className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400"
        >
          Done
        </Badge>
      );
    if (status === "failed")
      return (
        <Badge
          variant="outline"
          className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400"
        >
          Failed
        </Badge>
      );
    if (status === "running")
      return (
        <Badge
          variant="outline"
          className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400"
        >
          Running
        </Badge>
      );
    return <Badge variant="outline">{status}</Badge>;
  };

  type CountVariant = "ok" | "warn" | "muted";
  const countBadge = (label: string, n: number, variant: CountVariant) => {
    const cls =
      variant === "ok"
        ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20"
        : variant === "warn"
        ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20"
        : "text-muted-foreground";
    return (
      <Badge variant="outline" className={cls}>
        {n} {label}
      </Badge>
    );
  };

  // ── Guard: no company ─────────────────────────────────────────────────────

  if (!selectedCompanyId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          No company selected.
        </CardContent>
      </Card>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Provider-change blocking dialog ──────────────────────────────── */}
      <Dialog open={showBlockedDialog} onOpenChange={setShowBlockedDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Cannot Change POS Provider
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-1">
              <span className="block">
                You have a{" "}
                <strong>
                  {conn?.provider
                    ? providers.find((p) => p.providerKey === conn.provider)
                        ?.displayName ?? conn.provider
                    : "POS"}
                </strong>{" "}
                connection that is{" "}
                {conn?.status === "active" ? "active" : "retained but disconnected"}.
              </span>
              <span className="block">
                To switch providers, you must first explicitly disconnect the
                existing connection. Your connection history, location mappings,
                and historical sales data will remain intact.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBlockedDialog(false)}
            >
              OK — I'll Disconnect First
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Main card ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                POS &amp; Sales Data
              </CardTitle>
              <CardDescription className="mt-1">
                Configure your point-of-sale system and how sales data enter
                FnB Cost Pro.
              </CardDescription>
            </div>
            {isDirty && !saveMutation.isPending && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleSave}
                disabled={saveMutation.isPending}
                data-testid="button-save-pos-config"
              >
                Save Configuration
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* ── Section 1 — Provider + Method selectors ────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Provider picker */}
            <div className="space-y-2">
              <Label>POS System</Label>
              <Select value={localProvider} onValueChange={handleProviderChange}>
                <SelectTrigger data-testid="select-pos-provider">
                  <SelectValue placeholder="Select your POS system…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None / Not set —</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.providerKey} value={p.providerKey}>
                      {p.displayName}
                      {p.availability === "available" && (
                        <span className="ml-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                          ⚡ connector available
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedProviderMeta
                  ? selectedProviderMeta.availability === "available"
                    ? "Direct electronic connection is available for this POS."
                    : "No direct connector yet — manual report upload is available."
                  : "Select the POS system you use."}
              </p>
            </div>

            {/* Sales method picker — only when a provider is selected */}
            {localProvider !== "none" && (
              <div className="space-y-2">
                <Label>Sales Data Method</Label>
                <Select
                  value={localMethod ?? ""}
                  onValueChange={handleMethodChange}
                >
                  <SelectTrigger data-testid="select-sales-method">
                    <SelectValue placeholder="How do sales data come in?" />
                  </SelectTrigger>
                  <SelectContent>
                    {supportsElectronic && (
                      <SelectItem value="pos_connector">
                        ⚡ Connected POS — automatic nightly sync
                      </SelectItem>
                    )}
                    <SelectItem value="manual_upload">
                      📤 Manual Report Upload
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {localMethod === "pos_connector"
                    ? "Sales data are imported automatically each night."
                    : localMethod === "manual_upload"
                    ? "You upload sales report files manually."
                    : "Choose how sales data enter the app."}
                </p>
              </div>
            )}
          </div>

          {/* Method-change retention note */}
          {methodChangeNote && (
            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-blue-800 dark:text-blue-300 text-sm">
                {methodChangeNote}
              </AlertDescription>
            </Alert>
          )}

          {/* Validation / save errors */}
          {saveError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          {/* Save button — inline version when header one is not shown */}
          {isDirty && (
            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                data-testid="button-save-pos-config-inline"
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save Configuration"
                )}
              </Button>
            </div>
          )}

          {/* ── Section 2 — Connector status ───────────────────────────── */}
          {showConnectorSection && (
            <>
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-yellow-500" />
                    Square Connector
                  </h3>
                  {/* Only show Connect when there's no retained connection */}
                  {!hasRetainedConnection && (
                    <Button
                      size="sm"
                      onClick={handleConnectClick}
                      data-testid="button-square-connect"
                    >
                      <LinkIcon className="h-4 w-4 mr-2" />
                      Connect Square
                    </Button>
                  )}
                </div>

                {connectionsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading connection…
                  </div>
                ) : !conn ? (
                  <div className="border border-dashed rounded-lg py-8 text-center text-muted-foreground">
                    <Zap className="h-7 w-7 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No Square connection yet.</p>
                    <p className="text-xs mt-1">
                      Click &quot;Connect Square&quot; to start the OAuth flow.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Disconnected alert */}
                    {conn.status === "disconnected" && (
                      <Alert variant="destructive" className="py-2.5">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
                          <span>
                            <span className="font-medium">
                              Connection disconnected.
                            </span>{" "}
                            Square revoked access — nightly sync is paused.
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 border-destructive/40 hover:bg-destructive/10"
                            onClick={() => {
                              window.location.href = `/api/pos/connect/square/reconnect/${conn.id}`;
                            }}
                            data-testid={`button-square-reconnect-${conn.id}`}
                          >
                            <LinkIcon className="h-3 w-3 mr-1.5" />
                            Reconnect Square
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Identity + actions row */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        {conn.status === "active" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-sm">
                            Square
                            {conn.merchantId && (
                              <span className="text-muted-foreground font-normal ml-2 text-xs">
                                {conn.merchantId}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {conn.lastSyncedAt
                              ? `Last synced ${new Date(conn.lastSyncedAt).toLocaleString()}`
                              : "Never synced"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncNow(conn.id)}
                          disabled={
                            syncingId === conn.id ||
                            isJobRunning(conn.id) ||
                            conn.status !== "active"
                          }
                          data-testid={`button-square-sync-${conn.id}`}
                        >
                          {syncingId === conn.id || isJobRunning(conn.id) ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              Syncing…
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Sync Now
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setExpandedId(
                              expandedId === conn.id ? null : conn.id,
                            )
                          }
                        >
                          {expandedId === conn.id
                            ? "Hide Details"
                            : "Details"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => disconnectMutation.mutate(conn.id)}
                          disabled={disconnectMutation.isPending}
                          data-testid={`button-square-disconnect-${conn.id}`}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>

                    {/* Mapping progress from setup-status */}
                    {setupStatus &&
                      (setupStatus.locations.total > 0 ||
                        setupStatus.items.total > 0) && (
                        <div className="grid gap-3 sm:grid-cols-2 bg-muted/30 rounded-lg p-3">
                          {/* Locations */}
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              Location Mapping
                            </p>
                            <div className="flex gap-1.5 flex-wrap">
                              {countBadge(
                                "mapped",
                                setupStatus.locations.mapped,
                                "ok",
                              )}
                              {setupStatus.locations.unresolved > 0 &&
                                countBadge(
                                  "unresolved",
                                  setupStatus.locations.unresolved,
                                  "warn",
                                )}
                              {setupStatus.locations.ignored > 0 &&
                                countBadge(
                                  "ignored",
                                  setupStatus.locations.ignored,
                                  "muted",
                                )}
                            </div>
                            {setupStatus.locations.unresolved > 0 && (
                              <a
                                href={`/pos/location-mapping/${conn.id}`}
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                              >
                                Manage locations{" "}
                                <ArrowRight className="h-3 w-3" />
                              </a>
                            )}
                          </div>

                          {/* Items */}
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <Package className="h-3 w-3" />
                              Menu Item Mapping
                            </p>
                            <div className="flex gap-1.5 flex-wrap">
                              {countBadge(
                                "mapped",
                                setupStatus.items.mapped,
                                "ok",
                              )}
                              {setupStatus.items.unresolved > 0 &&
                                countBadge(
                                  "unresolved",
                                  setupStatus.items.unresolved,
                                  "warn",
                                )}
                              {setupStatus.items.ignored > 0 &&
                                countBadge(
                                  "ignored",
                                  setupStatus.items.ignored,
                                  "muted",
                                )}
                            </div>
                            {setupStatus.items.unresolved > 0 && (
                              <a
                                href={`/pos/item-mapping/${conn.id}`}
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                              >
                                Manage mappings{" "}
                                <ArrowRight className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                    {/* Sync timeline + warning summary */}
                    {setupStatus?.lastSuccessfulSyncAt && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                        <Clock className="h-3 w-3 shrink-0" />
                        Last successful sync:{" "}
                        {new Date(
                          setupStatus.lastSuccessfulSyncAt,
                        ).toLocaleString()}
                        {setupStatus.warningCount > 0 && (
                          <span className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5 ml-1">
                            <TriangleAlert className="h-3 w-3" />
                            {setupStatus.warningCount} warning
                            {setupStatus.warningCount === 1 ? "" : "s"} in
                            recent syncs
                          </span>
                        )}
                      </p>
                    )}

                    {/* Expanded detail panel */}
                    {expandedId === conn.id && (
                      <div className="border-t pt-3 space-y-3">
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" variant="outline" asChild>
                            <a href={`/pos/location-mapping/${conn.id}`}>
                              Edit Location Mapping
                            </a>
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <a href={`/pos/item-mapping/${conn.id}`}>
                              Edit Item Mapping
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => syncNow(conn.id, "backfill")}
                            disabled={
                              syncingId === conn.id || isJobRunning(conn.id)
                            }
                          >
                            {syncingId === conn.id ||
                            isJobRunning(conn.id) ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : null}
                            Backfill 30 Days
                          </Button>
                        </div>

                        {syncJobs.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                              Recent Syncs
                            </p>
                            {syncJobs.slice(0, 5).map((job: any) => (
                              <div
                                key={job.id}
                                className="flex items-center justify-between text-xs py-1.5 border-b last:border-0"
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  {jobStatusBadge(job.status)}
                                  <span className="capitalize">
                                    {job.jobType}
                                  </span>
                                  {job.rowsIngested > 0 && (
                                    <span className="text-muted-foreground">
                                      · {job.rowsIngested} rows
                                    </span>
                                  )}
                                  {job.rowsSkipped > 0 && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 cursor-default">
                                            <TriangleAlert className="h-3 w-3" />
                                            {job.rowsSkipped} skipped
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="top"
                                          className="max-w-[220px] text-center"
                                        >
                                          {job.rowsSkipped} item
                                          {job.rowsSkipped === 1 ? "" : "s"}{" "}
                                          had no menu item mapping — edit item
                                          mapping to capture them
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  {Array.isArray(job.adhocItems) &&
                                    job.adhocItems.length > 0 &&
                                    (() => {
                                      const lastEntry: any =
                                        job.adhocItems[
                                          job.adhocItems.length - 1
                                        ];
                                      const overflowTotal: number | undefined =
                                        lastEntry?._overflow
                                          ? lastEntry.total
                                          : undefined;
                                      const visibleItems =
                                        overflowTotal !== undefined
                                          ? job.adhocItems.slice(0, -1)
                                          : job.adhocItems;
                                      const displayCount =
                                        overflowTotal ?? visibleItems.length;
                                      return (
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400 cursor-default">
                                                <AlertCircle className="h-3 w-3" />
                                                {displayCount}
                                                {overflowTotal !== undefined
                                                  ? "+"
                                                  : ""}{" "}
                                                ad hoc
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent
                                              side="top"
                                              className="max-w-[240px] text-left"
                                            >
                                              <p className="font-medium mb-1">
                                                {displayCount}
                                                {overflowTotal !== undefined
                                                  ? "+"
                                                  : ""}{" "}
                                                item
                                                {displayCount === 1
                                                  ? ""
                                                  : "s"}{" "}
                                                sold without a catalog entry:
                                              </p>
                                              <ul className="space-y-0.5 max-h-[120px] overflow-y-auto">
                                                {(visibleItems as any[])
                                                  .slice(0, 8)
                                                  .map(
                                                    (item: any, i: number) => (
                                                      <li
                                                        key={i}
                                                        className="text-xs text-muted-foreground truncate"
                                                      >
                                                        · {item.name} (qty{" "}
                                                        {item.quantity})
                                                      </li>
                                                    ),
                                                  )}
                                                {overflowTotal !== undefined ? (
                                                  <li className="text-xs text-muted-foreground">
                                                    …and{" "}
                                                    {overflowTotal -
                                                      visibleItems.length}{" "}
                                                    more
                                                  </li>
                                                ) : visibleItems.length > 8 ? (
                                                  <li className="text-xs text-muted-foreground">
                                                    …and{" "}
                                                    {visibleItems.length - 8}{" "}
                                                    more
                                                  </li>
                                                ) : null}
                                              </ul>
                                              <p className="text-xs mt-1 text-muted-foreground">
                                                Add these to your Square
                                                catalog to track them.
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      );
                                    })()}
                                </div>
                                <span className="text-muted-foreground shrink-0">
                                  {new Date(job.createdAt).toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Section 3 — Manual upload ───────────────────────────────── */}
          {showManualSection && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  Manual Sales Upload
                </h3>
                {isManualOnlyProvider && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      A direct connector is not yet available for{" "}
                      <strong>
                        {selectedProviderMeta?.displayName}
                      </strong>
                      . Upload your sales export files below to import sales
                      data manually.
                    </AlertDescription>
                  </Alert>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a href="/tfc/sales-import">
                    Upload Sales Report
                    <ArrowRight className="ml-2 h-3 w-3" />
                  </a>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
