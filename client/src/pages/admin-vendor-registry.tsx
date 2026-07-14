import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle, XCircle, Trash2, Clock, Globe, Search, RotateCcw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type RegistryEntry = {
  id: string;
  normalized_name: string;
  exact_aliases: string[];
  aliases: string[];
  website_domains: string[];
  connector_id: string;
  status: "approved" | "pending" | "rejected";
  source: "seed" | "user_submitted";
  submitted_by_company_id: string | null;
  company_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  /** Stored at submission time: confidence tier the detect logic computed for this entry */
  detection_confidence: "high" | "medium" | "low" | null;
  /** Stored at submission time: human-readable reason for the confidence tier */
  detection_reason: string | null;
  /** Total submissions for this name→connector mapping (increments on re-submission after rejection) */
  submission_count: number;
  /** All company IDs that have submitted this mapping */
  submitted_by_company_ids: string[];
  created_at: string;
};

type ReviewDialogState = {
  entry: RegistryEntry;
  action: "approve" | "reject";
} | null;

const STATUS_COLORS: Record<string, string> = {
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  low: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

const CONNECTOR_LABELS: Record<string, string> = {
  sysco: "Sysco",
  gfs: "Gordon Food Service",
  usfoods: "US Foods",
  pfs: "Performance Food Service",
  sofo: "Southern Foods",
  generic: "Generic Vendor",
};

export default function AdminVendorRegistry() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (user !== undefined && user?.role !== "global_admin") {
      setLocation("/");
    }
  }, [user, setLocation]);

  if (!user || user.role !== "global_admin") {
    return null;
  }

  const { data, isLoading, error } = useQuery<{ data: RegistryEntry[] }>({
    queryKey: ["/api/admin/vendor-registry", statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/admin/vendor-registry?status=${statusFilter}`, {
        credentials: "include",
      });
      return res.json();
    },
    staleTime: 10_000,
  });

  const entries = (data?.data ?? []).filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.normalized_name.includes(q) ||
      e.connector_id.includes(q) ||
      (e.company_name ?? "").toLowerCase().includes(q) ||
      (e.aliases ?? []).some((a) => a.includes(q)) ||
      (e.website_domains ?? []).some((d) => d.includes(q))
    );
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: "approved" | "rejected"; notes?: string }) => {
      return apiRequest("PATCH", `/api/admin/vendor-registry/${id}/review`, {
        status,
        reviewNotes: notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vendor-registry"] });
      toast({ title: "Done", description: `Entry ${reviewDialog?.action === "approve" ? "approved" : "rejected"}.` });
      setReviewDialog(null);
      setReviewNotes("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/vendor-registry/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vendor-registry"] });
      toast({ title: "Deleted", description: "Registry entry removed." });
      setDeleteId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/admin/vendor-registry/${id}/reopen`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vendor-registry"] });
      toast({ title: "Reopened", description: "Entry moved back to pending review." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const pendingCount = (data?.data ?? []).filter((e) => e.status === "pending").length;

  return (
    <div className="p-4 pb-16 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/admin/users")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendor Registry</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage the global distributor name → connector mapping table.
            {pendingCount > 0 && (
              <span className="ml-2 font-medium text-yellow-600 dark:text-yellow-400">
                {pendingCount} pending {pendingCount === 1 ? "submission" : "submissions"}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, connector, domain…"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-registry"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="text-muted-foreground text-sm py-12 text-center">Loading…</div>
      )}
      {error && (
        <div className="text-destructive text-sm py-12 text-center">Failed to load registry.</div>
      )}

      {!isLoading && !error && entries.length === 0 && (
        <div className="text-muted-foreground text-sm py-12 text-center">No entries found.</div>
      )}

      {!isLoading && !error && entries.length > 0 && (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="border rounded-md p-4 bg-card flex flex-col sm:flex-row sm:items-start gap-3"
              data-testid={`card-registry-${entry.id}`}
            >
              {/* Main info */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium capitalize">{entry.normalized_name}</span>
                  <Badge variant="outline" className="text-xs">
                    {CONNECTOR_LABELS[entry.connector_id] ?? entry.connector_id}
                  </Badge>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[entry.status]}`}>
                    {entry.status}
                  </span>
                  {entry.source === "user_submitted" && (
                    <span className="text-xs text-muted-foreground">user submission</span>
                  )}
                </div>

                {entry.detection_confidence && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-default ${CONFIDENCE_COLORS[entry.detection_confidence]}`}
                        data-testid={`badge-confidence-${entry.id}`}
                      >
                        {entry.detection_confidence} confidence
                      </span>
                    </TooltipTrigger>
                    {entry.detection_reason && (
                      <TooltipContent>{entry.detection_reason}</TooltipContent>
                    )}
                  </Tooltip>
                )}
                {entry.submission_count > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-default flex items-center gap-1 ${
                          entry.status === "rejected" && entry.submission_count > 1
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                        data-testid={`badge-submission-count-${entry.id}`}
                      >
                        <Users className="h-3 w-3" />
                        {entry.submission_count} {entry.submission_count === 1 ? "submission" : "submissions"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {entry.status === "rejected" && entry.submission_count > 1
                        ? `${entry.submission_count} companies have submitted this mapping — consider reopening`
                        : `${entry.submission_count} ${entry.submission_count === 1 ? "company has" : "companies have"} submitted this mapping`}
                    </TooltipContent>
                  </Tooltip>
                )}
                {entry.exact_aliases?.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Exact: {entry.exact_aliases.join(", ")}
                  </p>
                )}
                {entry.aliases?.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Contains: {entry.aliases.join(", ")}
                  </p>
                )}
                {entry.website_domains?.length > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {entry.website_domains.join(", ")}
                  </p>
                )}
                {entry.company_name && (
                  <p className="text-xs text-muted-foreground">
                    Submitted by: <span className="font-medium">{entry.company_name}</span>
                  </p>
                )}
                {entry.review_notes && (
                  <p className="text-xs text-muted-foreground italic">Note: {entry.review_notes}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  <Clock className="inline h-3 w-3 mr-0.5" />
                  {new Date(entry.created_at).toLocaleDateString()}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 sm:flex-col sm:items-end shrink-0">
                {entry.status === "pending" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-green-700 border-green-300 dark:text-green-400 dark:border-green-700"
                      onClick={() => { setReviewDialog({ entry, action: "approve" }); setReviewNotes(""); }}
                      data-testid={`button-approve-${entry.id}`}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/40"
                      onClick={() => { setReviewDialog({ entry, action: "reject" }); setReviewNotes(""); }}
                      data-testid={`button-reject-${entry.id}`}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" />
                      Reject
                    </Button>
                  </>
                )}
                {entry.status === "rejected" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reopenMutation.isPending}
                        onClick={() => reopenMutation.mutate(entry.id)}
                        data-testid={`button-reopen-${entry.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        Reopen
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move back to pending review</TooltipContent>
                  </Tooltip>
                )}
                {entry.status !== "pending" && entry.source === "user_submitted" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteId(entry.id)}
                        data-testid={`button-delete-${entry.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete entry</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={(open) => { if (!open) setReviewDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewDialog?.action === "approve" ? "Approve" : "Reject"} registry entry
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium capitalize text-foreground">{reviewDialog?.entry.normalized_name}</span>
            {" → "}
            {CONNECTOR_LABELS[reviewDialog?.entry.connector_id ?? ""] ?? reviewDialog?.entry.connector_id}
          </p>
          <div className="space-y-2 mt-2">
            <label className="text-sm font-medium">Review notes (optional)</label>
            <Textarea
              placeholder="Reason for decision…"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={3}
              data-testid="textarea-review-notes"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialog(null)}>Cancel</Button>
            <Button
              variant={reviewDialog?.action === "approve" ? "default" : "destructive"}
              disabled={reviewMutation.isPending}
              onClick={() => {
                if (!reviewDialog) return;
                reviewMutation.mutate({
                  id: reviewDialog.entry.id,
                  status: reviewDialog.action === "approve" ? "approved" : "rejected",
                  notes: reviewNotes.trim() || undefined,
                });
              }}
              data-testid="button-confirm-review"
            >
              {reviewDialog?.action === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete registry entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the entry. Approved seed entries cannot be deleted here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
