import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle, XCircle, Trash2, Clock, Globe, Search, RotateCcw, Users, Pencil, Plus, ExternalLink, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  connector_id: string | null;
  category: string | null;
  website: string | null;
  ordering_url: string | null;
  portal_status: string | null;
  status: "approved" | "pending" | "rejected";
  source: "seed" | "user_submitted";
  submitted_by_company_id: string | null;
  company_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  detection_confidence: "high" | "medium" | "low" | null;
  detection_reason: string | null;
  submission_count: number;
  submitted_by_company_ids: string[];
  created_at: string;
};

type ReviewDialogState = {
  entry: RegistryEntry;
  action: "approve" | "reject";
} | null;

type EditFormState = {
  normalizedName: string;
  connectorId: string;
  category: string;
  website: string;
  orderingUrl: string;
  portalStatus: string;
};

const EMPTY_FORM: EditFormState = {
  normalizedName: "",
  connectorId: "",
  category: "",
  website: "",
  orderingUrl: "",
  portalStatus: "",
};

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

const CATEGORY_COLORS: Record<string, string> = {
  broadline: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  produce: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  seafood: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  protein: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  dairy: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  beverage: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  bakery: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  specialty: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400",
  ethnic: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  equipment: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400",
  packaging: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
};

function categoryColor(cat: string | null): string {
  if (!cat) return "bg-muted text-muted-foreground";
  return CATEGORY_COLORS[cat.toLowerCase()] ?? "bg-muted text-muted-foreground";
}

const CONNECTOR_LABELS: Record<string, string> = {
  sysco: "Sysco",
  gfs: "Gordon Food Service",
  usfoods: "US Foods",
  pfs: "Performance Food Service / Reinhart / Vistar",
  pfg: "Performance Food Group (Performance Net)",
  bek: "Ben E. Keith",
  sofo: "Southern Foods",
  generic: "Generic Vendor",
};

const KNOWN_CATEGORIES = [
  "Broadline", "Produce", "Seafood", "Protein", "Dairy", "Beverage",
  "Bakery", "Specialty", "Ethnic", "Equipment", "Packaging",
];

const PORTAL_STATUS_OPTIONS = [
  "Self-serve portal",
  "Contact rep",
  "EDI only",
  "Phone/fax only",
  "No portal",
];

export default function AdminVendorRegistry() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [editEntry, setEditEntry] = useState<RegistryEntry | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>(EMPTY_FORM);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<EditFormState>(EMPTY_FORM);

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
      (e.connector_id ?? "").includes(q) ||
      (e.category ?? "").toLowerCase().includes(q) ||
      (e.company_name ?? "").toLowerCase().includes(q) ||
      (e.portal_status ?? "").toLowerCase().includes(q) ||
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

  const editMutation = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: EditFormState }) => {
      return apiRequest("PATCH", `/api/admin/vendor-registry/${id}`, {
        normalizedName: form.normalizedName.trim() || undefined,
        connectorId: form.connectorId.trim() || null,
        category: form.category.trim() || null,
        website: form.website.trim() || null,
        orderingUrl: form.orderingUrl.trim() || null,
        portalStatus: form.portalStatus.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vendor-registry"] });
      toast({ title: "Saved", description: "Registry entry updated." });
      setEditEntry(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (form: EditFormState) => {
      return apiRequest("POST", `/api/admin/vendor-registry`, {
        normalizedName: form.normalizedName.trim(),
        connectorId: form.connectorId.trim() || null,
        category: form.category.trim() || null,
        website: form.website.trim() || null,
        orderingUrl: form.orderingUrl.trim() || null,
        portalStatus: form.portalStatus.trim() || null,
        status: "approved",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vendor-registry"] });
      toast({ title: "Created", description: "New registry entry added." });
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const pendingCount = (data?.data ?? []).filter((e) => e.status === "pending").length;

  function openEdit(entry: RegistryEntry) {
    setEditEntry(entry);
    setEditForm({
      normalizedName: entry.normalized_name,
      connectorId: entry.connector_id ?? "",
      category: entry.category ?? "",
      website: entry.website ?? "",
      orderingUrl: entry.ordering_url ?? "",
      portalStatus: entry.portal_status ?? "",
    });
  }

  return (
    <div className="p-4 pb-16 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/admin/users")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
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
        <Button
          size="sm"
          onClick={() => { setCreateForm(EMPTY_FORM); setCreateOpen(true); }}
          data-testid="button-add-registry-entry"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Entry
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, connector, category, domain…"
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
              <div className="flex-1 min-w-0 space-y-1.5">
                {/* Name + badges row */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium capitalize">{entry.normalized_name}</span>
                  {entry.connector_id && (
                    <Badge variant="outline" className="text-xs" data-testid={`badge-connector-${entry.id}`}>
                      {CONNECTOR_LABELS[entry.connector_id] ?? entry.connector_id}
                    </Badge>
                  )}
                  {entry.category && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor(entry.category)}`}
                      data-testid={`badge-category-${entry.id}`}
                    >
                      {entry.category}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[entry.status]}`}>
                    {entry.status}
                  </span>
                  {entry.source === "user_submitted" && (
                    <span className="text-xs text-muted-foreground">user submission</span>
                  )}
                </div>

                {/* Website + ordering portal */}
                {(entry.website || entry.ordering_url || entry.portal_status) && (
                  <div className="flex flex-wrap items-center gap-3">
                    {entry.website && (
                      <a
                        href={entry.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
                        data-testid={`link-website-${entry.id}`}
                      >
                        <Globe className="h-3 w-3 shrink-0" />
                        {entry.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                      </a>
                    )}
                    {entry.ordering_url && (
                      <a
                        href={entry.ordering_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
                        data-testid={`link-ordering-url-${entry.id}`}
                      >
                        <ShoppingCart className="h-3 w-3 shrink-0" />
                        Order portal
                        <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                      </a>
                    )}
                    {entry.portal_status && (
                      <span className="text-xs text-muted-foreground" data-testid={`text-portal-status-${entry.id}`}>
                        {entry.portal_status}
                      </span>
                    )}
                  </div>
                )}

                {/* Confidence badge */}
                {entry.detection_confidence && (
                  <div>
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
                  </div>
                )}

                {/* Submission count */}
                {entry.submission_count > 0 && (
                  <div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-default inline-flex items-center gap-1 ${
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
                  </div>
                )}

                {/* Aliases and domains */}
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEdit(entry)}
                      data-testid={`button-edit-${entry.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit entry</TooltipContent>
                </Tooltip>
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
            {reviewDialog?.entry.connector_id && (
              <>{" → "}{CONNECTOR_LABELS[reviewDialog.entry.connector_id] ?? reviewDialog.entry.connector_id}</>
            )}
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

      {/* Edit dialog */}
      <Dialog open={!!editEntry} onOpenChange={(open) => { if (!open) setEditEntry(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit registry entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-normalized-name">Normalized name</Label>
              <Input
                id="edit-normalized-name"
                value={editForm.normalizedName}
                onChange={(e) => setEditForm((f) => ({ ...f, normalizedName: e.target.value }))}
                placeholder="e.g. sysco"
                data-testid="input-edit-normalized-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-connector-id">Connector</Label>
              <Select
                value={editForm.connectorId || "__none__"}
                onValueChange={(v) => setEditForm((f) => ({ ...f, connectorId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="edit-connector-id" data-testid="select-edit-connector">
                  <SelectValue placeholder="No connector" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No connector</SelectItem>
                  {Object.entries(CONNECTOR_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-category">Category</Label>
              <Select
                value={editForm.category || "__none__"}
                onValueChange={(v) => setEditForm((f) => ({ ...f, category: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="edit-category" data-testid="select-edit-category">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {KNOWN_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-website">Website URL</Label>
              <Input
                id="edit-website"
                value={editForm.website}
                onChange={(e) => setEditForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="https://www.example.com"
                data-testid="input-edit-website"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-ordering-url">Ordering portal URL</Label>
              <Input
                id="edit-ordering-url"
                value={editForm.orderingUrl}
                onChange={(e) => setEditForm((f) => ({ ...f, orderingUrl: e.target.value }))}
                placeholder="https://shop.example.com"
                data-testid="input-edit-ordering-url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-portal-status">Portal status</Label>
              <Select
                value={editForm.portalStatus || "__none__"}
                onValueChange={(v) => setEditForm((f) => ({ ...f, portalStatus: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="edit-portal-status" data-testid="select-edit-portal-status">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not set</SelectItem>
                  {PORTAL_STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button
              disabled={editMutation.isPending || !editForm.normalizedName.trim()}
              onClick={() => { if (editEntry) editMutation.mutate({ id: editEntry.id, form: editForm }); }}
              data-testid="button-confirm-edit"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add registry entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-normalized-name">Normalized name <span className="text-destructive">*</span></Label>
              <Input
                id="create-normalized-name"
                value={createForm.normalizedName}
                onChange={(e) => setCreateForm((f) => ({ ...f, normalizedName: e.target.value }))}
                placeholder="e.g. sysco"
                data-testid="input-create-normalized-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-connector-id">Connector</Label>
              <Select
                value={createForm.connectorId || "__none__"}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, connectorId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="create-connector-id" data-testid="select-create-connector">
                  <SelectValue placeholder="No connector" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No connector</SelectItem>
                  {Object.entries(CONNECTOR_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-category">Category</Label>
              <Select
                value={createForm.category || "__none__"}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, category: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="create-category" data-testid="select-create-category">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No category</SelectItem>
                  {KNOWN_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-website">Website URL</Label>
              <Input
                id="create-website"
                value={createForm.website}
                onChange={(e) => setCreateForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="https://www.example.com"
                data-testid="input-create-website"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-ordering-url">Ordering portal URL</Label>
              <Input
                id="create-ordering-url"
                value={createForm.orderingUrl}
                onChange={(e) => setCreateForm((f) => ({ ...f, orderingUrl: e.target.value }))}
                placeholder="https://shop.example.com"
                data-testid="input-create-ordering-url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-portal-status">Portal status</Label>
              <Select
                value={createForm.portalStatus || "__none__"}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, portalStatus: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="create-portal-status" data-testid="select-create-portal-status">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not set</SelectItem>
                  {PORTAL_STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={createMutation.isPending || !createForm.normalizedName.trim()}
              onClick={() => createMutation.mutate(createForm)}
              data-testid="button-confirm-create"
            >
              Add Entry
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
