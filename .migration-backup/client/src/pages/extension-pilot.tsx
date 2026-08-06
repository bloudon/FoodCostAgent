/**
 * Extension Pilot — Internal Harness  (dev-only: /extension-pilot)
 *
 * Lets engineers exercise the full pairing + sync-job flow without the
 * Chrome extension loaded. Guards itself with import.meta.env.DEV so the
 * route is invisible in production builds.
 */

import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PairStatus {
  status: "pending" | "claimed" | "expired";
  pairingId: string;
}

interface SyncJob {
  id: string;
  status: string;
  connectorId: string;
  externalSupplierId?: string | null;
  externalSupplierName?: string | null;
  captureWarning?: string | null;
  itemCount?: number | null;
  errorMessage?: string | null;
  events?: Array<{ event: string; occurredAt: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: string): string {
  const map: Record<string, string> = {
    PENDING:     "bg-slate-500",
    PORTAL_OPEN: "bg-blue-600",
    CAPTURING:   "bg-violet-600",
    SUBMITTING:  "bg-amber-600",
    COMPLETE:    "bg-green-600",
    FAILED:      "bg-red-600",
    EXPIRED:     "bg-gray-600",
    AUTH_REQUIRED: "bg-yellow-600",
  };
  return map[s] ?? "bg-gray-500";
}

function pairingColor(s: string): string {
  return s === "claimed" ? "bg-green-600" : s === "expired" ? "bg-red-600" : "bg-amber-600";
}

function ts(d: string) {
  return new Date(d).toLocaleTimeString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExtensionPilot() {
  // ── Pairing ────────────────────────────────────────────────────────────────
  const [pairCode,    setPairCode]    = useState<string | null>(null);
  const [pairingId,   setPairingId]   = useState<string | null>(null);
  const [pairStatus,  setPairStatus]  = useState<PairStatus | null>(null);
  const [connectorId, setConnectorId] = useState("cut_and_dry");
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError,   setPairError]   = useState<string | null>(null);

  // ── Sync Job ───────────────────────────────────────────────────────────────
  const [jobConnector,   setJobConnector]   = useState("cut_and_dry");
  const [extSupplierId,  setExtSupplierId]  = useState("cut_dry_supplier_1");
  const [extSupplierName,setExtSupplierName]= useState("Demo Supplier");
  const [job,            setJob]            = useState<SyncJob | null>(null);
  const [jobLoading,     setJobLoading]     = useState(false);
  const [jobError,       setJobError]       = useState<string | null>(null);

  // ── Polling ────────────────────────────────────────────────────────────────
  const pairPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobPollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Log ───────────────────────────────────────────────────────────────────
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  function addLog(msg: string) {
    setLog((prev) => [...prev.slice(-199), `${new Date().toLocaleTimeString()} — ${msg}`]);
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (pairPollRef.current) clearInterval(pairPollRef.current);
    if (jobPollRef.current)  clearInterval(jobPollRef.current);
  }, []);

  // ── Pairing: generate code ────────────────────────────────────────────────
  async function handleGenerateCode() {
    setPairLoading(true);
    setPairError(null);
    setPairCode(null);
    setPairingId(null);
    setPairStatus(null);
    if (pairPollRef.current) clearInterval(pairPollRef.current);

    try {
      const res = await apiRequest("POST", "/api/extension/pair-code", { connectorId });
      const d = res.data;
      setPairCode(d.code);
      setPairingId(d.pairingId);
      addLog(`Pairing code created: ${d.code}  (pairingId: ${d.pairingId})`);

      // Poll for claimed status
      pairPollRef.current = setInterval(async () => {
        try {
          const pr = await apiRequest("GET", `/api/extension/pair-status/${d.pairingId}`);
          const ps: PairStatus = pr.data;
          setPairStatus(ps);
          addLog(`Pair status: ${ps.status}`);
          if (ps.status !== "pending") clearInterval(pairPollRef.current!);
        } catch (e: any) {
          addLog(`Poll error: ${e.message}`);
        }
      }, 3000);
    } catch (e: any) {
      setPairError(e.message ?? "Failed");
      addLog(`Error generating code: ${e.message}`);
    } finally {
      setPairLoading(false);
    }
  }

  // ── Sync Job: create ──────────────────────────────────────────────────────
  async function handleCreateJob() {
    setJobLoading(true);
    setJobError(null);
    setJob(null);
    if (jobPollRef.current) clearInterval(jobPollRef.current);

    try {
      const res = await apiRequest("POST", "/api/extension/sync-jobs", {
        connectorId:         jobConnector,
        externalSupplierId:  extSupplierId  || undefined,
        externalSupplierName: extSupplierName || undefined,
      });
      const j: SyncJob = res.data;
      setJob(j);
      addLog(`Sync job created: ${j.id}  status=${j.status}`);
      startJobPoll(j.id);
    } catch (e: any) {
      setJobError(e.message ?? "Failed");
      addLog(`Error creating job: ${e.message}`);
    } finally {
      setJobLoading(false);
    }
  }

  function startJobPoll(id: string) {
    if (jobPollRef.current) clearInterval(jobPollRef.current);
    jobPollRef.current = setInterval(async () => {
      try {
        const res = await apiRequest("GET", `/api/extension/sync-jobs/${id}`);
        const j: SyncJob = res.data;
        setJob(j);
        if (["COMPLETE", "FAILED", "EXPIRED"].includes(j.status)) {
          clearInterval(jobPollRef.current!);
          addLog(`Job ${id} terminal: ${j.status}`);
        }
      } catch (e: any) {
        addLog(`Job poll error: ${e.message}`);
      }
    }, 2500);
  }

  // ── Simulate events (dev testing without the real extension) ──────────────
  async function sendEvent(event: string) {
    if (!job) return;
    try {
      // Use fetch directly — apiRequest enforces session auth but we test the
      // bearer path here. For session-based test, use apiRequest.
      const res = await apiRequest("POST", `/api/extension/sync-jobs/${job.id}/events`, {
        event,
      });
      addLog(`Sent event "${event}" → status: ${res.data?.status}`);
      setJob((prev) => prev ? { ...prev, status: res.data?.status ?? prev.status } : prev);
    } catch (e: any) {
      addLog(`Event error: ${e.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {!import.meta.env.DEV && (
        <div className="text-center text-muted-foreground py-16 text-sm">
          This page is only available in development mode.
        </div>
      )}
      {import.meta.env.DEV && (
        <>
          <div>
            <h1 className="text-xl font-bold">Extension Pilot — Internal Harness</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Dev-only tool for exercising the pairing flow, sync job lifecycle, and ingestion pipeline.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* ── Step 1: Pairing ── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 1 — Pairing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="connector-id">Connector ID</Label>
                  <Input
                    id="connector-id"
                    data-testid="input-connector-id"
                    value={connectorId}
                    onChange={(e) => setConnectorId(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <Button
                  data-testid="button-generate-code"
                  onClick={handleGenerateCode}
                  disabled={pairLoading || !connectorId}
                  className="w-full"
                >
                  {pairLoading ? "Generating…" : "Generate Pairing Code"}
                </Button>
                {pairError && (
                  <p className="text-sm text-destructive" data-testid="text-pair-error">{pairError}</p>
                )}
                {pairCode && (
                  <div className="rounded-md bg-muted p-3 space-y-1" data-testid="pair-code-block">
                    <p className="text-xs text-muted-foreground">Code (show to extension user)</p>
                    <p className="text-2xl font-mono font-bold tracking-widest" data-testid="text-pair-code">
                      {pairCode}
                    </p>
                    <p className="text-xs text-muted-foreground">pairingId: {pairingId}</p>
                    <p className="text-xs text-muted-foreground">Polling every 3 s…</p>
                  </div>
                )}
                {pairStatus && (
                  <div className="flex items-center gap-2" data-testid="pair-status-block">
                    <span className="text-sm text-muted-foreground">Pair status:</span>
                    <Badge className={`text-white ${pairingColor(pairStatus.status)}`} data-testid="badge-pair-status">
                      {pairStatus.status.toUpperCase()}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Step 2: Sync Job ── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 2 — Sync Job</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="job-connector">Connector ID</Label>
                  <Input
                    id="job-connector"
                    data-testid="input-job-connector"
                    value={jobConnector}
                    onChange={(e) => setJobConnector(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="ext-supplier-id">External Supplier ID</Label>
                  <Input
                    id="ext-supplier-id"
                    data-testid="input-ext-supplier-id"
                    value={extSupplierId}
                    onChange={(e) => setExtSupplierId(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="ext-supplier-name">External Supplier Name</Label>
                  <Input
                    id="ext-supplier-name"
                    data-testid="input-ext-supplier-name"
                    value={extSupplierName}
                    onChange={(e) => setExtSupplierName(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <Button
                  data-testid="button-create-job"
                  onClick={handleCreateJob}
                  disabled={jobLoading || !jobConnector}
                  className="w-full"
                >
                  {jobLoading ? "Creating…" : "Create Sync Job"}
                </Button>
                {jobError && (
                  <p className="text-sm text-destructive" data-testid="text-job-error">{jobError}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Job Live Status ── */}
          {job && (
            <Card data-testid="job-status-card">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base">Live Job Status</CardTitle>
                  <Badge className={`text-white ${statusColor(job.status)}`} data-testid="badge-job-status">
                    {job.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <span className="text-muted-foreground">Job ID</span>
                  <span className="font-mono text-xs break-all" data-testid="text-job-id">{job.id}</span>
                  <span className="text-muted-foreground">Connector</span>
                  <span data-testid="text-job-connector">{job.connectorId}</span>
                  {job.externalSupplierName && (
                    <>
                      <span className="text-muted-foreground">Supplier</span>
                      <span data-testid="text-job-supplier">{job.externalSupplierName}</span>
                    </>
                  )}
                  {job.itemCount != null && (
                    <>
                      <span className="text-muted-foreground">Items updated</span>
                      <span data-testid="text-job-item-count">{job.itemCount}</span>
                    </>
                  )}
                  {job.captureWarning && (
                    <>
                      <span className="text-muted-foreground">Warning</span>
                      <span className="text-amber-600 font-medium" data-testid="text-job-warning">{job.captureWarning}</span>
                    </>
                  )}
                  {job.errorMessage && (
                    <>
                      <span className="text-muted-foreground">Error</span>
                      <span className="text-destructive" data-testid="text-job-error-msg">{job.errorMessage}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Updated</span>
                  <span data-testid="text-job-updated">{ts(job.updatedAt)}</span>
                </div>

                <Separator />

                {/* Simulate extension events (web-session auth path) */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Simulate extension lifecycle events (session auth):</p>
                  <div className="flex flex-wrap gap-2">
                    {["portal_opened","capture_started","ingestion_submitted","auth_required","capture_failed"].map((ev) => (
                      <Button
                        key={ev}
                        size="sm"
                        variant="outline"
                        data-testid={`button-event-${ev}`}
                        onClick={() => sendEvent(ev)}
                        disabled={["COMPLETE","EXPIRED"].includes(job.status)}
                      >
                        {ev.replace(/_/g, " ")}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Note: /events requires extension bearer in production. This harness calls it with web-session auth for testing.
                  </p>
                </div>

                {/* Events timeline */}
                {job.events && job.events.length > 0 && (
                  <>
                    <Separator />
                    <div data-testid="events-timeline">
                      <p className="text-xs text-muted-foreground mb-2">Event timeline:</p>
                      <div className="space-y-1">
                        {(job.events as Array<{ event: string; occurredAt: string; detail?: string }>).map((ev, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <span className="text-muted-foreground shrink-0">{ts(ev.occurredAt)}</span>
                            <span className="font-medium">{ev.event}</span>
                            {ev.detail && <span className="text-muted-foreground">{ev.detail}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Activity Log ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                ref={logRef}
                data-testid="activity-log"
                className="h-36 overflow-y-auto rounded-md bg-muted p-3 font-mono text-xs space-y-0.5"
              >
                {log.length === 0 && (
                  <span className="text-muted-foreground">No activity yet.</span>
                )}
                {log.map((line, i) => (
                  <div key={i} className="text-foreground/80">{line}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
