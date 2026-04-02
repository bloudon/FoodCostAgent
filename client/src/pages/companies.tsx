import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Company, InsertCompany, insertCompanySchema } from "@shared/schema";
import {
  Building2, MapPin, Plus, Settings2, UserCircle, Trash2, AlertTriangle,
  Users, CreditCard, Clock, MailWarning, RefreshCw, Activity,
  ChevronDown, ChevronUp, Wand2,
} from "lucide-react";
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

export default function Companies() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isNewCompanyDialogOpen, setIsNewCompanyDialogOpen] = useState(false);
  const [incompleteSignupsExpanded, setIncompleteSignupsExpanded] = useState(true);

  const { data: companies, isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
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
