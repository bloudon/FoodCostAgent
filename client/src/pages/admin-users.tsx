import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Users, UserCheck, UserX, Activity,
  Search, Building2, ShieldCheck, Shield, UserCog, User,
} from "lucide-react";

type AdminUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  active: number | boolean;
  created_at: string;
  company_id: string | null;
  company_name: string | null;
  subscription_tier: string | null;
  last_login_at: string | null;
  active_session_count: number | string;
};

type AdminUsersResponse = {
  users: AdminUser[];
  stats: {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    activeToday: number;
  };
};

function formatRelativeTime(isoStr: string | null): string {
  if (!isoStr) return "Never";
  const date = new Date(isoStr);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.floor(diffMo / 12)}y ago`;
}

function formatFullDate(isoStr: string | null): string {
  if (!isoStr) return "Never";
  return new Date(isoStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  global_admin: {
    label: "Global Admin",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    icon: ShieldCheck,
  },
  company_admin: {
    label: "Company Admin",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    icon: Shield,
  },
  store_manager: {
    label: "Store Manager",
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    icon: UserCog,
  },
  store_user: {
    label: "Store User",
    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    icon: User,
  },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] ?? {
    label: role,
    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    icon: User,
  };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums leading-tight">{value}</p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminUsers() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading } = useQuery<AdminUsersResponse>({
    queryKey: ["/api/admin/users"],
    enabled: user?.role === "global_admin",
  });

  if (user?.role !== "global_admin") {
    setLocation("/");
    return null;
  }

  const filteredUsers = useMemo(() => {
    if (!data?.users) return [];
    const q = search.trim().toLowerCase();
    return data.users.filter((u) => {
      const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.toLowerCase();
      const matchesSearch =
        !q ||
        name.includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.company_name ?? "").toLowerCase().includes(q);
      const matchesRole = roleFilter === "all" || u.role === roleFilter;
      const isActive = u.active === 1 || u.active === true;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && isActive) ||
        (statusFilter === "inactive" && !isActive);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [data?.users, search, roleFilter, statusFilter]);

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/companies")}
            data-testid="button-back-to-dashboard"
            title="Back to Admin Dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">All Users</h1>
            <p className="text-muted-foreground text-sm">Global user roster across all companies</p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-8 w-16 mb-1" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              icon={<Users className="h-5 w-5 text-primary" />}
              label="Total Users"
              value={data?.stats.totalUsers ?? 0}
              testId="card-stat-total-users"
            />
            <StatCard
              icon={<UserCheck className="h-5 w-5 text-green-500" />}
              label="Active"
              value={data?.stats.activeUsers ?? 0}
              testId="card-stat-active-users"
            />
            <StatCard
              icon={<UserX className="h-5 w-5 text-muted-foreground" />}
              label="Inactive"
              value={data?.stats.inactiveUsers ?? 0}
              testId="card-stat-inactive-users"
            />
            <StatCard
              icon={<Activity className="h-5 w-5 text-amber-500" />}
              label="Active Today"
              value={data?.stats.activeToday ?? 0}
              testId="card-stat-active-today"
            />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, email, or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-user-search"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-44" data-testid="select-role-filter">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="global_admin">Global Admin</SelectItem>
            <SelectItem value="company_admin">Company Admin</SelectItem>
            <SelectItem value="store_manager">Store Manager</SelectItem>
            <SelectItem value="store_user">Store User</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {(search || roleFilter !== "all" || statusFilter !== "all") && (
          <Button
            variant="ghost"
            size="default"
            onClick={() => { setSearch(""); setRoleFilter("all"); setStatusFilter("all"); }}
            data-testid="button-clear-filters"
          >
            Clear
          </Button>
        )}
      </div>

      {/* Count */}
      {!isLoading && (
        <p className="text-xs text-muted-foreground mb-3" data-testid="text-results-count">
          Showing {filteredUsers.length} of {data?.stats.totalUsers ?? 0} users
        </p>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground" data-testid="text-no-results">
              No users match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-users">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Email</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Company</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Role</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Status</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">Last Login</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredUsers.map((u) => {
                    const isActive = u.active === 1 || u.active === true;
                    const displayName =
                      [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
                    return (
                      <tr
                        key={u.id}
                        className="hover:bg-muted/20 transition-colors"
                        data-testid={`row-user-${u.id}`}
                      >
                        {/* Name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-semibold">
                              {(u.first_name?.[0] ?? u.email?.[0] ?? "?").toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate" data-testid={`text-name-${u.id}`}>{displayName}</p>
                              <p className="text-xs text-muted-foreground truncate md:hidden">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        {/* Email */}
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-muted-foreground" data-testid={`text-email-${u.id}`}>{u.email}</span>
                        </td>
                        {/* Company */}
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {u.company_name ? (
                            <div className="flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span data-testid={`text-company-${u.id}`}>{u.company_name}</span>
                              {u.subscription_tier && (
                                <Badge variant="secondary" className="text-xs ml-1">
                                  {u.subscription_tier}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        {/* Role */}
                        <td className="px-4 py-3">
                          <RoleBadge role={u.role} />
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <Badge
                            variant={isActive ? "default" : "secondary"}
                            className={isActive ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 no-default-active-elevate" : ""}
                            data-testid={`badge-status-${u.id}`}
                          >
                            {isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        {/* Last Login */}
                        <td className="px-4 py-3 hidden xl:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="text-muted-foreground cursor-default"
                                data-testid={`text-last-login-${u.id}`}
                              >
                                {formatRelativeTime(u.last_login_at)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatFullDate(u.last_login_at)}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        {/* Joined */}
                        <td className="px-4 py-3 hidden xl:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="text-muted-foreground cursor-default"
                                data-testid={`text-joined-${u.id}`}
                              >
                                {formatRelativeTime(u.created_at)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {formatFullDate(u.created_at)}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
