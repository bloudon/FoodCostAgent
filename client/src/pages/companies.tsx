import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Company, InsertCompany, insertCompanySchema } from "@shared/schema";
import {
  Building2, MapPin, Plus, Settings2, UserCircle, Trash2, AlertTriangle,
  Users, CreditCard, Clock, MailWarning, RefreshCw, Activity,
  ChevronDown, ChevronUp, Wand2, MessageSquare, CheckCircle, XCircle,
  Pencil, Check, X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIER_LABELS, type Tier, TIERS } from "@shared/tier-config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

type AdminStats = {
  totalCompanies: number;
  pendingSignups: number;
  activeUsers: number;
  activeSessions: number;
};

type OrphanedSignup = {
  companyId: string;
  companyName: string;
  companyCreatedAt: string | null;
  userId: string | null;
  userEmail: string | null;
  userFirstName: string | null;
  userActive: number | null;
};

type ChatLogRow = {
  id: string;
  company_id: string;
  company_name: string | null;
  user_id: string | null;
  user_message: string;
  assistant_response: string;
  tier: string;
  created_at: string;
};

type ChatLogsResponse = {
  logs: ChatLogRow[];
  todayCount: number;
  mostActiveCompany: { name: string; count: number } | null;
};

type ChatCorrection = {
  id: string;
  chat_log_id: string | null;
  user_message: string;
  corrected_response: string;
  is_active: number;
  created_at: string;
};

export default function Companies() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isNewCompanyDialogOpen, setIsNewCompanyDialogOpen] = useState(false);
  const [incompleteSignupsExpanded, setIncompleteSignupsExpanded] = useState(true);
  const [chatLogsExpanded, setChatLogsExpanded] = useState(false);
  const [correctionsExpanded, setCorrectionsExpanded] = useState(false);
  const [chatLogCompanyFilter, setChatLogCompanyFilter] = useState<string>("all");
  const [expandedCorrectionForm, setExpandedCorrectionForm] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState<string>("");

  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const chatLogsQuery = useQuery<ChatLogsResponse>({
    queryKey: ["/api/admin/chat-logs", chatLogCompanyFilter],
    queryFn: () => {
      const url = chatLogCompanyFilter !== "all"
        ? `/api/admin/chat-logs?companyId=${chatLogCompanyFilter}`
        : "/api/admin/chat-logs";
      return fetch(url).then(r => r.json());
    },
    enabled: chatLogsExpanded,
    refetchInterval: 30000,
  });

  const correctionsQuery = useQuery<ChatCorrection[]>({
    queryKey: ["/api/admin/chat-corrections"],
    enabled: chatLogsExpanded,
  });

  const createCorrectionMutation = useMutation({
    mutationFn: (payload: { chatLogId?: string | null; userMessage: string; correctedResponse: string }) =>
      fetch("/api/admin/chat-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat-corrections"] });
      setExpandedCorrectionForm(null);
      setCorrectionDraft("");
      toast({ description: "Correction saved and will be injected into future prompts." });
    },
    onError: () => toast({ variant: "destructive", description: "Failed to save correction." }),
  });

  const toggleCorrectionMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: number }) =>
      fetch(`/api/admin/chat-corrections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat-corrections"] });
    },
  });

  const deleteCorrectionMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/admin/chat-corrections/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chat-corrections"] });
      toast({ description: "Correction deleted." });
    },
  });

  const { data: adminStats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    refetchInterval: 30000,
  });

  const { data: orphanedSignups, isLoading: orphansLoading } = useQuery<OrphanedSignup[]>({
    queryKey: ["/api/admin/orphaned-signups"],
    refetchInterval: 60000,
  });

  const form = useForm<InsertCompany>({
    resolver: zodResolver(insertCompanySchema),
    defaultValues: {
      name: "",
      status: "active",
      country: "US",
      timezone: "America/New_York",
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data: InsertCompany) => {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setIsNewCompanyDialogOpen(false);
      form.reset();
      toast({ title: "Company created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create company", description: error.message, variant: "destructive" });
    },
  });

  const purgeCompanyMutation = useMutation({
    mutationFn: async ({ companyId, dryRun }: { companyId: string; dryRun: boolean }) => {
      const response = await apiRequest(
        "DELETE",
        `/api/admin/companies/${companyId}/purge?dryRun=${dryRun}`,
        undefined
      );
      return await response.json();
    },
    onSuccess: (data) => {
      if (data.dryRun) {
        toast({
          title: "Dry Run Complete",
          description: `Would delete ${data.summary.totalRowsDeleted} rows from ${data.summary.tablesAffected} tables`,
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/orphaned-signups"] });
        toast({
          title: "Company Purged",
          description: `Deleted ${data.summary.totalRowsDeleted} rows from ${data.summary.tablesAffected} tables`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Purge Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resendOtpMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/orphaned-signups/${companyId}/resend-otp`,
        {}
      );
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Activation code sent",
        description: `A new code was sent to ${data.email}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send code", description: error.message, variant: "destructive" });
    },
  });

  const updateTierMutation = useMutation({
    mutationFn: async ({ companyId, tier }: { companyId: string; tier: string }) => {
      const response = await apiRequest("PATCH", `/api/admin/companies/${companyId}/subscription`, { tier });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Subscription tier updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update tier", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateCompany = (data: InsertCompany) => {
    createCompanyMutation.mutate(data);
  };

  const handlePurgeCompany = (companyId: string, dryRun: boolean = false) => {
    purgeCompanyMutation.mutate({ companyId, dryRun });
  };

  const handleSelectCompany = async (companyId: string) => {
    try {
      await apiRequest("POST", "/api/auth/select-company", { companyId });
      localStorage.setItem("selectedCompanyId", companyId);
      window.location.href = "/";
    } catch (error) {
      console.error("Failed to select company:", error);
      toast({
        title: "Error",
        description: "Failed to select company",
        variant: "destructive",
      });
    }
  };

  const handleManageCompany = (companyId: string) => {
    setLocation(`/companies/${companyId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-lg">Loading companies...</div>
      </div>
    );
  }

  const hasOrphans = (orphanedSignups?.length ?? 0) > 0;

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold mb-1" data-testid="text-page-title">Admin Dashboard</h1>
          <p className="text-muted-foreground text-sm">System health and company management</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setLocation("/onboarding-wizard")}
            data-testid="button-launch-onboarding-wizard"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Launch Onboarding Wizard
          </Button>
          <Dialog open={isNewCompanyDialogOpen} onOpenChange={setIsNewCompanyDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-company">
                <Plus className="h-4 w-4 mr-2" />
                New Company
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Company</DialogTitle>
              <DialogDescription>Add a new company to the system</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleCreateCompany)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Pizza Paradise Inc." data-testid="input-new-company-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="legalName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Legal Name (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} data-testid="input-new-legal-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" value={field.value || ""} data-testid="input-new-contact-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-new-timezone">
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="America/New_York">Eastern Time</SelectItem>
                          <SelectItem value="America/Chicago">Central Time</SelectItem>
                          <SelectItem value="America/Denver">Mountain Time</SelectItem>
                          <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tccAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>TCC Account ID (Thrive POS)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="614fe428-d6f5-4c82-984e-383bc0344f85" data-testid="input-new-tcc-account-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsNewCompanyDialogOpen(false)}
                    data-testid="button-cancel-new-company"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createCompanyMutation.isPending} data-testid="button-save-new-company">
                    {createCompanyMutation.isPending ? "Creating..." : "Create Company"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={<Building2 className="h-5 w-5 text-primary" />}
          label="Companies"
          value={adminStats?.totalCompanies ?? "—"}
          testId="card-stat-total-companies"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-amber-500" />}
          label="Pending Signups"
          value={adminStats?.pendingSignups ?? "—"}
          highlight={!!adminStats?.pendingSignups}
          testId="card-stat-pending-signups"
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-primary" />}
          label="Active Users"
          value={adminStats?.activeUsers ?? "—"}
          testId="card-stat-active-users"
        />
        <StatCard
          icon={<Activity className="h-5 w-5 text-green-500" />}
          label="Active Now (30m)"
          value={adminStats?.activeSessions ?? "—"}
          testId="card-stat-active-sessions"
        />
      </div>

      {/* Incomplete signups section */}
      {(hasOrphans || orphansLoading) && (
        <Card className="mb-6 border-amber-200 dark:border-amber-900" data-testid="card-incomplete-signups">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MailWarning className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-base">Incomplete Signups</CardTitle>
              {hasOrphans && (
                <Badge variant="secondary" className="text-xs" data-testid="badge-orphan-count">
                  {orphanedSignups!.length}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground hidden sm:block">
                Companies created but never activated.
              </p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIncompleteSignupsExpanded((v) => !v)}
                data-testid="button-toggle-incomplete-signups"
                title={incompleteSignupsExpanded ? "Collapse" : "Expand"}
              >
                {incompleteSignupsExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardHeader>
          {incompleteSignupsExpanded && (
          <CardContent className="p-0">
            {orphansLoading ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">Loading...</div>
            ) : (
              <div className="divide-y">
                {orphanedSignups!.map((orphan) => (
                  <div
                    key={orphan.companyId}
                    className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap"
                    data-testid={`row-orphan-${orphan.companyId}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" data-testid={`text-orphan-name-${orphan.companyId}`}>
                          {orphan.companyName}
                        </span>
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:border-amber-700">
                          Pending Activation
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        {orphan.userEmail && (
                          <span data-testid={`text-orphan-email-${orphan.companyId}`}>{orphan.userEmail}</span>
                        )}
                        {orphan.companyCreatedAt && (
                          <span>
                            Created {new Date(orphan.companyCreatedAt).toLocaleDateString(undefined, {
                              month: "short", day: "numeric", year: "numeric"
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resendOtpMutation.mutate(orphan.companyId)}
                        disabled={resendOtpMutation.isPending}
                        data-testid={`button-resend-otp-${orphan.companyId}`}
                      >
                        {resendOtpMutation.isPending ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Resend Code
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`button-purge-orphan-${orphan.companyId}`}
                            title="Delete incomplete signup"
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5 text-destructive" />
                              <AlertDialogTitle>Delete Incomplete Signup?</AlertDialogTitle>
                            </div>
                            <AlertDialogDescription>
                              This will permanently remove the company <strong>{orphan.companyName}</strong> and its pending user
                              {orphan.userEmail && <> ({orphan.userEmail})</>}. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePurgeCompany(orphan.companyId, false);
                              }}
                              disabled={purgeCompanyMutation.isPending}
                              className="bg-destructive hover:bg-destructive/90"
                              data-testid={`button-confirm-purge-orphan-${orphan.companyId}`}
                            >
                              {purgeCompanyMutation.isPending ? "Deleting..." : "Delete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          )}
        </Card>
      )}

      {/* AI Chat Logs & Corrections */}
      <Card className="mb-6" data-testid="card-chat-logs">
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <MessageSquare className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">AI Chat Logs</CardTitle>
            {chatLogsQuery.data && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-chat-today">
                {chatLogsQuery.data.todayCount} today
              </Badge>
            )}
            {chatLogsQuery.data?.mostActiveCompany && (
              <Badge variant="outline" className="text-xs" data-testid="badge-chat-most-active">
                Most active: {chatLogsQuery.data.mostActiveCompany.name} ({chatLogsQuery.data.mostActiveCompany.count})
              </Badge>
            )}
            {correctionsQuery.data && (
              <Badge variant="outline" className="text-xs" data-testid="badge-corrections-active">
                {correctionsQuery.data.filter(c => c.is_active === 1).length} active corrections
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setChatLogsExpanded(v => !v)}
            data-testid="button-toggle-chat-logs"
            title={chatLogsExpanded ? "Collapse" : "Expand"}
          >
            {chatLogsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CardHeader>

        {chatLogsExpanded && (
          <CardContent className="pt-0">
            {/* Company filter */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-sm text-muted-foreground">Filter by company:</span>
              <select
                className="text-sm border rounded-md px-2 py-1 bg-background"
                value={chatLogCompanyFilter}
                onChange={e => setChatLogCompanyFilter(e.target.value)}
                data-testid="select-chat-log-company-filter"
              >
                <option value="all">All companies</option>
                {companies?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Active Corrections sub-section */}
            <div className="mb-4">
              <button
                className="flex items-center gap-2 text-sm font-semibold mb-2 hover-elevate rounded-md px-1"
                onClick={() => setCorrectionsExpanded(v => !v)}
                data-testid="button-toggle-corrections"
              >
                {correctionsExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Active Corrections
                <Badge variant="secondary" className="text-xs">
                  {correctionsQuery.data?.filter(c => c.is_active === 1).length ?? 0} active / {correctionsQuery.data?.length ?? 0} total
                </Badge>
              </button>

              {correctionsExpanded && (
                <div className="space-y-2">
                  {correctionsQuery.isLoading && (
                    <p className="text-sm text-muted-foreground">Loading corrections...</p>
                  )}
                  {correctionsQuery.data?.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No corrections yet.</p>
                  )}
                  {correctionsQuery.data?.map(correction => (
                    <div
                      key={correction.id}
                      className={`border rounded-md p-3 text-sm ${correction.is_active === 1 ? "border-border" : "border-border/40 opacity-60"}`}
                      data-testid={`row-correction-${correction.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-muted-foreground text-xs mb-1">Question pattern:</p>
                          <p className="text-sm mb-2">{correction.user_message}</p>
                          <p className="font-medium text-muted-foreground text-xs mb-1">Ideal answer:</p>
                          <p className="text-sm whitespace-pre-wrap">{correction.corrected_response}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            title={correction.is_active === 1 ? "Disable" : "Enable"}
                            onClick={() => toggleCorrectionMutation.mutate({ id: correction.id, isActive: correction.is_active === 1 ? 0 : 1 })}
                            data-testid={`button-toggle-correction-${correction.id}`}
                          >
                            {correction.is_active === 1
                              ? <CheckCircle className="h-4 w-4 text-green-600" />
                              : <XCircle className="h-4 w-4 text-muted-foreground" />
                            }
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Delete correction"
                            onClick={() => deleteCorrectionMutation.mutate(correction.id)}
                            data-testid={`button-delete-correction-${correction.id}`}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Add standalone correction */}
                  {expandedCorrectionForm === "__new__" ? (
                    <div className="border rounded-md p-3 space-y-2 mt-2" data-testid="form-new-correction">
                      <p className="text-xs font-semibold text-muted-foreground">New correction</p>
                      <Textarea
                        placeholder="Question pattern (e.g. 'How do I add a vendor?')"
                        rows={2}
                        id="new-correction-q"
                        className="text-sm"
                        data-testid="input-new-correction-question"
                      />
                      <Textarea
                        placeholder="Ideal answer..."
                        rows={4}
                        value={correctionDraft}
                        onChange={e => setCorrectionDraft(e.target.value)}
                        className="text-sm"
                        data-testid="input-new-correction-answer"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            const q = (document.getElementById("new-correction-q") as HTMLTextAreaElement)?.value;
                            if (q && correctionDraft) {
                              createCorrectionMutation.mutate({ userMessage: q, correctedResponse: correctionDraft });
                            }
                          }}
                          disabled={createCorrectionMutation.isPending}
                          data-testid="button-save-new-correction"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setExpandedCorrectionForm(null); setCorrectionDraft(""); }}
                          data-testid="button-cancel-new-correction"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1"
                      onClick={() => setExpandedCorrectionForm("__new__")}
                      data-testid="button-add-correction"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Add Correction
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Q&A log cards */}
            {chatLogsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading chat logs...</p>
            ) : chatLogsQuery.data?.logs.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No chat logs found.</p>
            ) : (
              <div className="space-y-3">
                {chatLogsQuery.data?.logs.map(log => (
                  <div
                    key={log.id}
                    className="border rounded-md p-3 text-sm"
                    data-testid={`row-chat-log-${log.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">{log.company_name ?? log.company_id}</Badge>
                        <Badge variant="secondary" className="text-xs capitalize">{log.tier}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="font-medium mb-1">Q: {log.user_message}</p>
                    <p className="text-muted-foreground whitespace-pre-wrap">A: {log.assistant_response}</p>

                    {/* Inline "Add Correction from this log" */}
                    {expandedCorrectionForm === log.id ? (
                      <div className="mt-3 border-t pt-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground">Edit the AI response to the ideal answer:</p>
                        <Textarea
                          rows={6}
                          value={correctionDraft}
                          onChange={e => setCorrectionDraft(e.target.value)}
                          className="text-sm"
                          data-testid={`input-correction-draft-${log.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              if (correctionDraft) {
                                createCorrectionMutation.mutate({
                                  chatLogId: log.id,
                                  userMessage: log.user_message,
                                  correctedResponse: correctionDraft,
                                });
                              }
                            }}
                            disabled={createCorrectionMutation.isPending || !correctionDraft}
                            data-testid={`button-save-correction-${log.id}`}
                          >
                            Save Correction
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setExpandedCorrectionForm(null); setCorrectionDraft(""); }}
                            data-testid={`button-cancel-correction-${log.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="mt-2 text-xs text-muted-foreground underline hover-elevate rounded-sm"
                        onClick={() => {
                          setExpandedCorrectionForm(log.id);
                          setCorrectionDraft(log.assistant_response);
                        }}
                        data-testid={`button-add-correction-from-log-${log.id}`}
                      >
                        <Pencil className="h-3 w-3 inline mr-1" />
                        Add correction for this response
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Companies list */}
      <div className="mb-4 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          All Companies
        </h2>
      </div>

      <div className="space-y-2">
        {companies?.map((company) => (
          <Card
            key={company.id}
            className="hover-elevate transition-all"
            data-testid={`card-company-${company.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                {/* Left: Company info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <Building2 className="h-5 w-5 text-primary flex-shrink-0" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-lg">{company.name}</h3>
                      <Badge variant={company.status === "active" ? "default" : "secondary"} className="text-xs">
                        {company.status}
                      </Badge>
                      <TierBadge tier={(company.subscriptionTier as Tier) || "free"} />
                    </div>
                  </div>

                  <div className="flex items-center gap-4 ml-8 mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Tier:</span>
                      <Select
                        value={(company.subscriptionTier as Tier) || "free"}
                        onValueChange={(value) => {
                          updateTierMutation.mutate({ companyId: company.id, tier: value });
                        }}
                      >
                        <SelectTrigger className="h-7 w-24 text-xs" data-testid={`select-tier-${company.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIERS.map((t) => (
                            <SelectItem key={t} value={t}>{TIER_LABELS[t]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {(company.subscriptionStatus || company.stripeCustomerId || company.subscriptionCurrentPeriodEnd) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground cursor-help">
                            <CreditCard className="h-3 w-3" />
                            <span>{company.subscriptionStatus || "none"}</span>
                            {company.subscriptionTerm && <span>({company.subscriptionTerm})</span>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs space-y-1">
                          {company.stripeCustomerId && <div>Stripe: {company.stripeCustomerId}</div>}
                          {company.subscriptionCurrentPeriodEnd && (
                            <div>Period ends: {new Date(company.subscriptionCurrentPeriodEnd).toLocaleDateString()}</div>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {company.addressLine1 && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground ml-8">
                      <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <div>{company.addressLine1}</div>
                        {company.addressLine2 && <div>{company.addressLine2}</div>}
                        <div>
                          {company.city && `${company.city}, `}
                          {company.state} {company.postalCode}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectCompany(company.id);
                    }}
                    data-testid={`button-become-company-${company.id}`}
                    title="Become this company"
                  >
                    <UserCircle className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleManageCompany(company.id);
                    }}
                    data-testid={`button-manage-company-${company.id}`}
                    title="Manage company"
                  >
                    <Settings2 className="h-5 w-5" />
                  </Button>

                  {/* Purge button — available to all global admins */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`button-purge-company-${company.id}`}
                        title="Purge company data"
                        className="text-destructive"
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                      <AlertDialogHeader>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                          <AlertDialogTitle>Purge Company Data?</AlertDialogTitle>
                        </div>
                        <AlertDialogDescription>
                          This will permanently delete <strong>ALL</strong> data for <strong>{company.name}</strong>:
                          <ul className="list-disc list-inside mt-2 space-y-1">
                            <li>All stores and inventory</li>
                            <li>All vendors and purchase orders</li>
                            <li>All recipes and menu items</li>
                            <li>All sales data and reports</li>
                            <li>All users in this company</li>
                          </ul>
                          <p className="mt-3 text-destructive font-semibold">
                            This action cannot be undone!
                          </p>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <Button
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePurgeCompany(company.id, true);
                          }}
                          disabled={purgeCompanyMutation.isPending}
                          data-testid={`button-dry-run-purge-${company.id}`}
                        >
                          Dry Run (Preview)
                        </Button>
                        <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePurgeCompany(company.id, false);
                          }}
                          disabled={purgeCompanyMutation.isPending}
                          className="bg-destructive hover:bg-destructive/90"
                          data-testid={`button-confirm-purge-${company.id}`}
                        >
                          {purgeCompanyMutation.isPending ? "Purging..." : "Purge Company"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {companies?.length === 0 && (
        <div className="text-center py-12">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No companies found</h3>
          <p className="text-muted-foreground">No companies have been created yet.</p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight = false,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  highlight?: boolean;
  testId?: string;
}) {
  return (
    <Card className={highlight ? "border-amber-300 dark:border-amber-700" : ""} data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-md bg-muted flex-shrink-0">
            {icon}
          </div>
          <div>
            <p
              className={`text-2xl font-bold leading-none ${highlight ? "text-amber-600 dark:text-amber-400" : ""}`}
              data-testid={testId ? `${testId}-value` : undefined}
            >
              {value}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TierBadge({ tier }: { tier: Tier }) {
  const variant = tier === "pro" ? "destructive" : tier === "basic" ? "default" : "secondary";
  return (
    <Badge variant={variant} className="text-xs" data-testid={`badge-tier-${tier}`}>
      {TIER_LABELS[tier]}
    </Badge>
  );
}
