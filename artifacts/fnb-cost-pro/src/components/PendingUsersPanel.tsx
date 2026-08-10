import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { UserCheck, ChevronDown, ChevronUp, Info, Mail, Clock } from "lucide-react";
import type { Company, CompanyStore } from "@shared/schema";

type PendingUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  active: number;
  created_at: string;
  sso_provider: string | null;
  last_login_at: string | null;
  matchingInvitation: {
    id: string;
    email: string;
    company_id: string;
    company_name: string | null;
    role: string;
    store_ids: string[];
    token: string;
    expires_at: string;
    created_at: string;
  } | null;
};

type PendingUsersResponse = {
  pendingUsers: PendingUser[];
};

function formatRelative(isoStr: string | null): string {
  if (!isoStr) return "Never";
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(isoStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function AssignDialog({
  user,
  companies,
  open,
  onOpenChange,
  onAssigned,
}: {
  user: PendingUser;
  companies: Company[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}) {
  const { toast } = useToast();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(
    user.matchingInvitation?.company_id ?? ""
  );
  const [selectedRole, setSelectedRole] = useState<string>(
    user.matchingInvitation?.role ?? "store_user"
  );
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(
    new Set(user.matchingInvitation?.store_ids ?? [])
  );
  const [revokeInvitation, setRevokeInvitation] = useState(true);

  const { data: stores = [] } = useQuery<CompanyStore[]>({
    queryKey: ["/api/companies", selectedCompanyId, "stores"],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const res = await fetch(`/api/companies/${selectedCompanyId}/stores`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedCompanyId,
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/admin/pending-users/${user.id}/assign`, {
        companyId: selectedCompanyId,
        role: selectedRole,
        storeIds: Array.from(selectedStoreIds),
        revokeInvitationId:
          revokeInvitation && user.matchingInvitation ? user.matchingInvitation.id : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "User assigned", description: `${user.email} has been assigned to the company.` });
      onAssigned();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Assignment failed",
        description: err.message || "Failed to assign user",
        variant: "destructive",
      });
    },
  });

  const handleStoreToggle = (storeId: string) => {
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };

  const handleCompanyChange = (companyId: string) => {
    setSelectedCompanyId(companyId);
    setSelectedStoreIds(new Set());
  };

  const needsStores = selectedRole === "store_user" || selectedRole === "store_manager";
  const canSubmit =
    !!selectedCompanyId &&
    !!selectedRole &&
    (!needsStores || selectedStoreIds.size > 0);

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {displayName}</DialogTitle>
          <DialogDescription>
            Assign this account to a company and grant access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* User info */}
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium">{displayName}</p>
            <p className="text-muted-foreground text-xs">{user.email}</p>
            {user.sso_provider && (
              <Badge variant="secondary" className="mt-1 text-xs">
                SSO · {user.sso_provider}
              </Badge>
            )}
          </div>

          {/* Matching invitation notice */}
          {user.matchingInvitation && (
            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-xs">
                <span className="font-medium">Pending invitation found</span> — an invitation for this email
                exists for <span className="font-medium">{user.matchingInvitation.company_name || user.matchingInvitation.company_id}</span> as{" "}
                <span className="font-medium">{user.matchingInvitation.role.replace(/_/g, " ")}</span>.
                Pre-filled below. Assigning will mark the invitation as consumed.
              </AlertDescription>
            </Alert>
          )}

          {/* Company picker */}
          <div className="space-y-1.5">
            <Label>Company</Label>
            <Select value={selectedCompanyId} onValueChange={handleCompanyChange}>
              <SelectTrigger data-testid="select-assign-company">
                <SelectValue placeholder="Select a company…" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Role picker */}
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger data-testid="select-assign-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="company_admin">Company Admin</SelectItem>
                <SelectItem value="store_manager">Store Manager</SelectItem>
                <SelectItem value="store_user">Store User</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Store assignments */}
          {selectedCompanyId && needsStores && (
            <div className="space-y-1.5">
              <Label>
                Store Assignments
                <span className="text-destructive ml-1">*</span>
              </Label>
              {stores.length === 0 ? (
                <p className="text-xs text-muted-foreground border rounded-md p-3">
                  No stores found for this company.
                </p>
              ) : (
                <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                  {stores.map((store) => (
                    <div key={store.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`assign-store-${store.id}`}
                        checked={selectedStoreIds.has(store.id)}
                        onCheckedChange={() => handleStoreToggle(store.id)}
                        data-testid={`checkbox-assign-store-${store.id}`}
                      />
                      <Label
                        htmlFor={`assign-store-${store.id}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {store.name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Invitation revoke option */}
          {user.matchingInvitation && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="revoke-invitation"
                checked={revokeInvitation}
                onCheckedChange={(v) => setRevokeInvitation(!!v)}
                data-testid="checkbox-revoke-invitation"
              />
              <Label htmlFor="revoke-invitation" className="text-sm font-normal cursor-pointer">
                Mark the matching invitation as consumed
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={assignMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => assignMutation.mutate()}
            disabled={!canSubmit || assignMutation.isPending}
            data-testid="button-confirm-assign"
          >
            {assignMutation.isPending ? "Assigning…" : "Assign User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PendingUsersPanel({ companies }: { companies: Company[] }) {
  const [expanded, setExpanded] = useState(true);
  const [assigningUser, setAssigningUser] = useState<PendingUser | null>(null);

  const { data, isLoading, refetch } = useQuery<PendingUsersResponse>({
    queryKey: ["/api/admin/pending-users"],
    refetchInterval: 60000,
  });

  const pendingUsers = data?.pendingUsers ?? [];

  if (isLoading) {
    return null; // Silent while loading — avoids layout shift when there are none
  }

  if (pendingUsers.length === 0) {
    return null; // Nothing to show
  }

  return (
    <>
      <Card
        className="mb-6 border-orange-200 dark:border-orange-900"
        data-testid="card-pending-approval"
      >
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-base">Pending Approval</CardTitle>
            <Badge
              variant="secondary"
              className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
              data-testid="badge-pending-count"
            >
              {pendingUsers.length}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground hidden sm:block">
              Authenticated but not yet assigned to a company.
            </p>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded((v) => !v)}
              data-testid="button-toggle-pending-users"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="p-0">
            <div className="divide-y">
              {pendingUsers.map((user) => {
                const displayName =
                  [user.first_name, user.last_name].filter(Boolean).join(" ") || "—";
                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap"
                    data-testid={`row-pending-user-${user.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-medium text-sm"
                          data-testid={`text-pending-name-${user.id}`}
                        >
                          {displayName}
                        </span>
                        {user.sso_provider && (
                          <Badge variant="secondary" className="text-xs">
                            SSO · {user.sso_provider}
                          </Badge>
                        )}
                        {user.matchingInvitation && (
                          <Badge
                            variant="outline"
                            className="text-xs text-blue-600 border-blue-300 dark:border-blue-700"
                            title={`Pending invitation for ${user.matchingInvitation.company_name ?? user.matchingInvitation.company_id}`}
                          >
                            <Mail className="h-2.5 w-2.5 mr-1" />
                            Invited
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        <span data-testid={`text-pending-email-${user.id}`}>{user.email}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Signed up {formatRelative(user.created_at)}
                        </span>
                        {user.last_login_at && (
                          <span>Last active {formatRelative(user.last_login_at)}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setAssigningUser(user)}
                      data-testid={`button-assign-pending-${user.id}`}
                    >
                      Assign
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {assigningUser && (
        <AssignDialog
          user={assigningUser}
          companies={companies}
          open={!!assigningUser}
          onOpenChange={(open) => {
            if (!open) setAssigningUser(null);
          }}
          onAssigned={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-users"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
          }}
        />
      )}
    </>
  );
}
