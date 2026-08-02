import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ChevronLeft, Plus, Pencil, Trash2, Play, CheckCircle2, XCircle, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { REPORT_LABELS } from "./reportColumnDefs";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";

const REPORT_TYPES = ["recipe_cost", "inventory_value", "purchase_activity"] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, "0")}:00 UTC`,
}));

interface Sub {
  id: string;
  name: string;
  report_type: string;
  schedule_frequency: string;
  schedule_hour: number;
  email_recipients: string[];
  is_active: number;
  last_run_at: string | null;
  filters: any;
}

interface Log {
  id: string;
  triggered_at: string;
  status: string;
  emails_sent: number;
  error_message: string | null;
}

const defaultForm = {
  name: "",
  reportType: "recipe_cost" as typeof REPORT_TYPES[number],
  storeId: "",
  scheduleFrequency: "daily",
  scheduleHour: "8",
  emailRecipients: "",
};

export default function ScheduledReportsPage() {
  const { toast } = useToast();
  const { data: stores = [] } = useAccessibleStores();
  const [openDialog, setOpenDialog] = useState(false);
  const [editSub, setEditSub] = useState<Sub | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sub | null>(null);
  const [logsFor, setLogsFor] = useState<Sub | null>(null);
  const [form, setForm] = useState({ ...defaultForm });

  const { data: subs = [], isLoading } = useQuery<Sub[]>({
    queryKey: ["/api/report-subscriptions"],
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<Log[]>({
    queryKey: [`/api/report-subscriptions/${logsFor?.id}/logs`],
    enabled: !!logsFor,
  });

  const createMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/report-subscriptions", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-subscriptions"] });
      toast({ title: "Subscription created" });
      setOpenDialog(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      apiRequest("PUT", `/api/report-subscriptions/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-subscriptions"] });
      toast({ title: "Subscription updated" });
      setOpenDialog(false);
      setEditSub(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/report-subscriptions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-subscriptions"] });
      toast({ title: "Subscription deleted" });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runNowMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/report-subscriptions/${id}/run`),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/report-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: [`/api/report-subscriptions/${id}/logs`] });
      toast({ title: "Report queued", description: "The report is being sent now." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditSub(null);
    setForm({ ...defaultForm });
    setOpenDialog(true);
  }

  function openEdit(sub: Sub) {
    setEditSub(sub);
    setForm({
      name: sub.name,
      reportType: sub.report_type as any,
      storeId: sub.filters?.storeId ?? "",
      scheduleFrequency: sub.schedule_frequency,
      scheduleHour: String(sub.schedule_hour),
      emailRecipients: (sub.email_recipients ?? []).join(", "),
    });
    setOpenDialog(true);
  }

  function handleSave() {
    const emails = form.emailRecipients.split(",").map(e => e.trim()).filter(Boolean);
    const body = {
      name: form.name,
      reportType: form.reportType,
      scheduleFrequency: form.scheduleFrequency,
      scheduleHour: Number(form.scheduleHour),
      emailRecipients: emails,
      isActive: 1,
      filters: form.storeId ? { storeId: form.storeId } : undefined,
    };
    if (editSub) {
      updateMut.mutate({ id: editSub.id, body });
    } else {
      createMut.mutate(body);
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/reports">
            <Button variant="ghost" size="sm" className="gap-1 -ml-2">
              <ChevronLeft className="h-4 w-4" />
              Reports
            </Button>
          </Link>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Scheduled Reports</h1>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New Schedule
        </Button>
      </div>

      {/* List */}
      {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {!isLoading && subs.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="font-medium mb-1">No scheduled reports yet</p>
          <p className="text-sm">Create a schedule to automatically email reports to your team.</p>
        </div>
      )}

      <div className="space-y-3">
        {subs.map(sub => (
          <div key={sub.id} className="border rounded-lg p-4 flex items-start justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{sub.name}</span>
                <Badge variant={sub.is_active ? "default" : "secondary"}>
                  {sub.is_active ? "Active" : "Paused"}
                </Badge>
                <Badge variant="outline">{REPORT_LABELS[sub.report_type] ?? sub.report_type}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {sub.schedule_frequency === "weekly" ? "Every Monday" : "Daily"} at{" "}
                {String(sub.schedule_hour).padStart(2, "0")}:00 UTC
                {" · "}
                {(sub.email_recipients ?? []).length} recipient{(sub.email_recipients ?? []).length !== 1 ? "s" : ""}
              </p>
              {sub.last_run_at && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last run: {new Date(sub.last_run_at).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => runNowMut.mutate(sub.id)}
                disabled={runNowMut.isPending && runNowMut.variables === sub.id}
                title="Send now"
              >
                <Play className="h-4 w-4 text-emerald-600" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setLogsFor(logsFor?.id === sub.id ? null : sub)} title="View logs">
                <Clock className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => openEdit(sub)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(sub)} title="Delete">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Logs panel */}
      {logsFor && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">Run log — {logsFor.name}</p>
            <Button variant="ghost" size="sm" onClick={() => setLogsFor(null)}>Close</Button>
          </div>
          {logsLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!logsLoading && logs.length === 0 && (
            <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
          )}
          <div className="space-y-1.5">
            {logs.map(log => (
              <div key={log.id} className="flex items-center gap-3 text-sm">
                {log.status === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <span className="text-muted-foreground w-40 shrink-0">
                  {new Date(log.triggered_at).toLocaleString()}
                </span>
                {log.status === "success" ? (
                  <span>{log.emails_sent} email{log.emails_sent !== 1 ? "s" : ""} sent</span>
                ) : (
                  <span className="text-destructive truncate">{log.error_message ?? "Unknown error"}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={openDialog} onOpenChange={v => { if (!v) { setOpenDialog(false); setEditSub(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSub ? "Edit Schedule" : "New Scheduled Report"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Weekly Inventory Value"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Report type</Label>
              <Select value={form.reportType} onValueChange={v => setForm(f => ({ ...f, reportType: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{REPORT_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(form.reportType === "inventory_value" || form.reportType === "purchase_activity") && (
              <div className="space-y-1">
                <Label>Location (optional)</Label>
                <Select value={form.storeId || "all"} onValueChange={v => setForm(f => ({ ...f, storeId: v === "all" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="All locations" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All locations</SelectItem>
                    {(stores ?? []).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Frequency</Label>
                <Select value={form.scheduleFrequency} onValueChange={v => setForm(f => ({ ...f, scheduleFrequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly (Mon)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Send at (UTC)</Label>
                <Select value={form.scheduleHour} onValueChange={v => setForm(f => ({ ...f, scheduleHour: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.map(h => (
                      <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Recipients (comma-separated emails)</Label>
              <Input
                placeholder="alice@example.com, bob@example.com"
                value={form.emailRecipients}
                onChange={e => setForm(f => ({ ...f, emailRecipients: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenDialog(false); setEditSub(null); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !form.name.trim() || !form.emailRecipients.trim()}
            >
              {isSaving ? "Saving…" : (editSub ? "Save changes" : "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scheduled report?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be deleted and no further emails will be sent. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
