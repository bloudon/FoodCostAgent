import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Users, UserCheck, UserX, Activity,
  Search, Building2, ShieldCheck, Shield, UserCog, User,
  ArrowUpDown, ArrowUp, ArrowDown,
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

type SortColumn =
  | "name"
  | "email"
  | "company"
  | "role"
  | "status"
  | "last_login"
  | "joined";

type SortDirection = "asc" | "desc";

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function formatRelativeTime(isoStr: string | null): string {
  if (!isoStr) return "Never";
  const diffMs = Date.now() - new Date(isoStr).getTime();
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

const ROLE_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  global_admin: {
    label: "Global Admin",
    color:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    icon: ShieldCheck,
  },
  company_admin: {
    label: "Company Admin",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    icon: Shield,
  },
  store_manager: {
    label: "Store Manager",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    icon: UserCog,
  },
  store_user: {
    label: "Store User",
    color:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    icon: User,
  },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] ?? {
    label: role,
    color:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    icon: User,
  };
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md ${cfg.color}`}
    >
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
          <p className="text-2xl font-bold tabular-nums leading-tight">
            {value}
          </p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SortIcon({
  column,
  sortBy,
  sortDir,
}: {
  column: SortColumn;
  sortBy: SortColumn;
  sortDir: SortDirection;
}) {
  if (column !== sortBy) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3.5 w-3.5 ml-1" />
    : <ArrowDown className="h-3.5 w-3.5 ml-1" />;
}

function sortValue(u: AdminUser, col: SortColumn): string | number {
  switch (col) {
    case "name":
      return `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim().toLowerCase();
    case "email":
      return (u.email ?? "").toLowerCase();
    case "company":
      return (u.company_name ?? "").toLowerCase();
    case "role":
      return u.role ?? "";
    case "status":
      return u.active === 1 || u.active === true ? 0 : 1;
    case "last_login":
      return u.last_login_at ? new Date(u.last_login_at).getTime() : 0;
    case "joined":
      return u.created_at ? new Date(u.created_at).getTime() : 0;
    default:
      return "";
  }
}

export default function AdminUsers() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortColumn>("joined");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const search = useDebounce(searchInput, 300);

  useEffect(() => {
    if (!authLoading && user?.role !== "global_admin") {
      setLocation("/");
    }
  }, [authLoading, user, setLocation]);

  const { data, isLoading } = useQuery<AdminUsersResponse>({
    queryKey: ["/api/admin/users"],
    enabled: !authLoading && user?.role === "global_admin",
  });

  if (authLoading || user?.role !== "global_admin") {
    return null;
  }

  function handleSort(col: SortColumn) {
    if (col === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  const filteredUsers = useMemo(() => {
    if (!data?.users) return [];
    const q = search.trim().toLowerCase();
    let rows = data.users.filter((u) => {
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

    rows = [...rows].sort((a, b) => {
      const av = sortValue(a, sortBy);
      const bv = sortValue(b, sortBy);
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [data?.users, search, roleFilter, statusFilter, sortBy, sortDir]);

  const hasFilters =
    searchInput.trim() !== "" || roleFilter !== "all" || statusFilter !== "all";

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
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              All Users
            </h1>
            <p className="text-muted-foreground text-sm">
              Global user roster across all companies
            </p>
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
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
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
        {hasFilters && (
          <Button
            variant="ghost"
            size="default"
            onClick={() => {
              setSearchInput("");
              setRoleFilter("all");
              setStatusFilter("all");
            }}
            data-testid="button-clear-filters"
          >
            Clear
          </Button>
        )}
      </div>

      {/* Count */}
      {!isLoading && (
        <p
          className="text-xs text-muted-foreground mb-3"
          data-testid="text-results-count"
        >
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
            <div
              className="p-12 text-center text-muted-foreground"
              data-testid="text-no-results"
            >
              No users match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-users">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    {(
                      [
                        { col: "name" as SortColumn, label: "Name", className: "" },
                        { col: "email" as SortColumn, label: "Email", className: "hidden md:table-cell" },
                        { col: "company" as SortColumn, label: "Company", className: "hidden lg:table-cell" },
                        { col: "role" as SortColumn, label: "Role", className: "" },
                        { col: "status" as SortColumn, label: "Status", className: "hidden sm:table-cell" },
                        { col: "last_login" as SortColumn, label: "Last Login", className: "hidden xl:table-cell" },
                        { col: "joined" as SortColumn, label: "Joined", className: "hidden xl:table-cell" },
                      ] as const
                    ).map(({ col, label, className }) => (
                      <th
                        key={col}
                        className={`px-4 py-3 font-medium text-muted-foreground cursor-pointer select-none ${className}`}
                        onClick={() => handleSort(col)}
                        data-testid={`th-${col}`}
                      >
                        <span className="inline-flex items-center">
                          {label}
                          <SortIcon column={col} sortBy={sortBy} sortDir={sortDir} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredUsers.map((u) => {
                    const isActive = u.active === 1 || u.active === true;
                    const displayName =
                      [u.first_name, u.last_name].filter(Boolean).join(" ") ||
                      "—";
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
                              {(
                                u.first_name?.[0] ??
                                u.email?.[0] ??
                                "?"
                              ).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p
                                className="font-medium truncate"
                                data-testid={`text-name-${u.id}`}
                              >
                                {displayName}
                              </p>
                              <p className="text-xs text-muted-foreground truncate md:hidden">
                                {u.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        {/* Email */}
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span
                            className="text-muted-foreground"
                            data-testid={`text-email-${u.id}`}
                          >
                            {u.email}
                          </span>
                        </td>
                        {/* Company */}
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {u.company_name ? (
                            <div className="flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span data-testid={`text-company-${u.id}`}>
                                {u.company_name}
                              </span>
                              {u.subscription_tier && (
                                <Badge
                                  variant="secondary"
                                  className="text-xs ml-1"
                                >
                                  {u.subscription_tier}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
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
                            className={
                              isActive
                                ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 no-default-active-elevate"
                                : ""
                            }
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
