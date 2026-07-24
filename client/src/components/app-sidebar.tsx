import { Link, useLocation } from "wouter";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  ShoppingCart,
  ChefHat,
  BarChart3,
  MoreHorizontal,
  Store,
  LogOut,
  Pin,
  PinOff,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/lib/auth-context";
import { useAppLanguage } from "@/lib/language-context";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useCompany } from "@/hooks/use-company";
import { useStoreContext } from "@/hooks/use-store-context";
import { useTier } from "@/hooks/use-tier";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 300;
const EXPANDED_WIDTH = "230px";

// ---------------------------------------------------------------------------
// Section routing helpers
// ---------------------------------------------------------------------------

function getActiveSection(loc: string): string {
  if (loc === "/") return "home";

  if (
    loc === "/count" ||
    loc.startsWith("/count/") ||
    loc.startsWith("/inventory-items") ||
    loc.startsWith("/inventory-sessions") ||
    loc.startsWith("/inventory-count") ||
    loc.startsWith("/new-count") ||
    loc.startsWith("/item-count") ||
    loc.startsWith("/shelf-scans") ||
    loc === "/waste" ||
    loc.startsWith("/waste/") ||
    loc.startsWith("/prep-chart/on-hand")
  ) return "count";

  if (
    loc === "/order" ||
    loc.startsWith("/orders") ||
    loc.startsWith("/purchase-orders") ||
    loc.startsWith("/vendors") ||
    loc.startsWith("/receiving") ||
    loc.startsWith("/transfer-orders") ||
    loc.startsWith("/order-guide")
  ) return "order";

  if (
    loc === "/prep" ||
    (loc.startsWith("/prep-chart") && !loc.startsWith("/prep-chart/on-hand"))
  ) return "prep";

  if (
    loc === "/analyze" ||
    loc.startsWith("/variance") ||
    loc.startsWith("/tfc") ||
    loc.startsWith("/menu-insights")
  ) return "analyze";

  return "more";
}

// ---------------------------------------------------------------------------
// Rail definition
// ---------------------------------------------------------------------------

interface RailItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  roles?: string[];
  testId: string;
}

const RAIL: RailItem[] = [
  { id: "home",    label: "Home",    icon: LayoutDashboard, href: "/",        testId: "nav-home" },
  { id: "count",   label: "Count",   icon: ClipboardList,   href: "/count",   testId: "nav-count" },
  { id: "order",   label: "Order",   icon: ShoppingCart,    href: "/order",   roles: ["store_manager", "company_admin", "global_admin"], testId: "nav-order" },
  { id: "prep",    label: "Prep",    icon: ChefHat,         href: "/prep",    testId: "nav-prep" },
  { id: "analyze", label: "Analyze", icon: BarChart3,        href: "/analyze", roles: ["store_manager", "company_admin", "global_admin"], testId: "nav-analyze" },
  { id: "more",    label: "More",    icon: MoreHorizontal,  href: "/more",    testId: "nav-more" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t } = useAppLanguage();
  const { company } = useCompany();
  const { selectedStoreId, setSelectedStoreId, stores } = useStoreContext();
  useAccessibleStores(); // keeps store list warm in React Query cache
  const { setOpen, isMobile, setOpenMobile } = useSidebar();
  const { theme } = useTheme();
  const { hasFeature } = useTier();

  // ── Hover-rail state ───────────────────────────────────────────────────────
  const [isPinned, setIsPinned] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate pin preference after mount (avoids SSR/hydration mismatch)
  useEffect(() => {
    const pinned = localStorage.getItem("sidebarPinned") === "true";
    setIsPinned(pinned);
    setOpen(pinned);
  }, []); // intentionally empty — run once on mount

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // Escape key: close temporary hover only, never unpin
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isHovering && !isPinned) setIsHovering(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHovering, isPinned]);

  const isExpanded = isMobile || isPinned || isHovering;

  const togglePin = useCallback(() => {
    const next = !isPinned;
    setIsPinned(next);
    setOpen(next);
    localStorage.setItem("sidebarPinned", String(next));
    if (!next) setIsHovering(false);
  }, [isPinned, setOpen]);

  const scheduleOpen = useCallback(() => {
    if (isMobile || isPinned) return;
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    openTimerRef.current = setTimeout(() => setIsHovering(true), OPEN_DELAY_MS);
  }, [isMobile, isPinned]);

  const scheduleClose = useCallback(() => {
    if (isMobile || isPinned) return;
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    closeTimerRef.current = setTimeout(() => setIsHovering(false), CLOSE_DELAY_MS);
  }, [isMobile, isPinned]);

  const handleMouseEnter = () => scheduleOpen();
  const handleMouseLeave = () => scheduleClose();

  const handleFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (isMobile || isPinned) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
      setIsHovering(true);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (isMobile || isPinned) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
      setIsHovering(false);
    }
  };

  // ── Overlay style (applied to the fixed container div via ...props spread) ─
  const overlayActive = !isMobile && isHovering && !isPinned;
  const containerStyle: React.CSSProperties | undefined = overlayActive
    ? { width: EXPANDED_WIDTH, zIndex: 50 }
    : undefined;
  const containerClassName = overlayActive
    ? "shadow-[4px_0_16px_rgba(0,0,0,0.08)] border-r border-sidebar-border"
    : undefined;

  // ── Derived values ─────────────────────────────────────────────────────────
  const logoImage = theme === "dark" ? "/website-logo-dark.png" : "/website-logo.png";
  const role = user?.role ?? "store_user";
  const isGlobalAdmin = role === "global_admin";

  const closeMobile = () => { if (isMobile) setOpenMobile(false); };

  const activeSection = getActiveSection(location);

  const visibleItems = RAIL.filter((item) => {
    if (isGlobalAdmin && !company && item.id !== "home" && item.id !== "more") return false;
    if (item.roles && !item.roles.includes(role)) return false;
    if (item.id === "prep" && !hasFeature("prep_chart")) return false;
    return true;
  });

  const userInitials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
      : user?.email?.[0]?.toUpperCase() ?? "U";

  const userName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email ?? "User";

  const currentStoreName = stores.find((s) => s.id === selectedStoreId)?.name ?? "Select store";

  return (
    <Sidebar
      collapsible="icon"
      style={containerStyle}
      className={containerClassName}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      aria-label="Application navigation"
    >
      {/* ── Header: logo + store selector ────────────────────────────────── */}
      <SidebarHeader className="border-b pb-3">
        <div className="flex items-center justify-center px-3 pt-2">
          <Link
            href="/"
            onClick={closeMobile}
            data-testid="link-dashboard-logo"
            className="flex w-full items-center justify-center"
          >
            {isExpanded ? (
              <img
                src={logoImage}
                alt="FNB Cost Pro"
                className="w-full max-h-12 object-contain"
                data-testid="logo"
              />
            ) : (
              <img
                src={logoImage}
                alt="FNB Cost Pro"
                className="h-7 w-auto object-contain"
                data-testid="logo-collapsed"
              />
            )}
          </Link>
        </div>

        {company && isMobile && (
          <div
            className="font-semibold text-sm px-1 pb-0.5 truncate"
            data-testid="text-company-name-mobile"
          >
            {company.name}
          </div>
        )}

        {company && stores.length > 0 && (
          isExpanded ? (
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger
                className="w-full h-8 text-xs"
                data-testid={isMobile ? "select-store-mobile" : "select-store"}
              >
                <Store className="h-3.5 w-3.5 mr-1 shrink-0" />
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem
                    key={store.id}
                    value={store.id}
                    data-testid={`select-store-${store.id}`}
                  >
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex justify-center w-full py-1 text-sidebar-foreground/60 hover-elevate rounded-md"
                  aria-label={`Store: ${currentStoreName}`}
                >
                  <Store className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{currentStoreName}</TooltipContent>
            </Tooltip>
          )
        )}
      </SidebarHeader>

      {/* ── Content: flat rail ───────────────────────────────────────────── */}
      <SidebarContent>
        <SidebarMenu className="gap-0.5 px-2 py-2">
          {visibleItems.map((item) => {
            const active = activeSection === item.id;
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={isExpanded ? undefined : item.label}
                  data-testid={isMobile ? `${item.testId}-mobile` : item.testId}
                  className="gap-3"
                >
                  <Link href={item.href} onClick={closeMobile}>
                    <item.icon className="h-4 w-4 shrink-0" />
                    {isExpanded && (
                      <span className={cn("font-medium", active && "font-semibold")}>
                        {item.label}
                      </span>
                    )}
                    {!isExpanded && (
                      <span className="sr-only">{item.label}</span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      {/* ── Footer: user + controls ──────────────────────────────────────── */}
      <SidebarFooter className="border-t p-2 space-y-1">
        {isExpanded && (
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0 text-left text-sm leading-tight">
              <p className="truncate font-semibold">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
        )}

        <div className={cn(
          "flex items-center gap-1",
          !isExpanded && "flex-col items-center"
        )}>
          {!isExpanded && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold mb-1 cursor-default"
                  aria-label={userName}
                >
                  {userInitials}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">{userName}</TooltipContent>
            </Tooltip>
          )}

          {isExpanded && <div className="flex-1" />}

          <ThemeToggle />
          <LanguageToggle />

          {/* Pin/unpin — desktop only, visible while expanded */}
          {!isMobile && isExpanded && (
            <button
              onClick={togglePin}
              className="inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover-elevate active-elevate-2 transition-colors"
              title={isPinned ? "Unpin sidebar" : "Pin sidebar"}
              data-testid="button-sidebar-pin"
              aria-label={isPinned ? "Unpin sidebar" : "Pin sidebar"}
            >
              {isPinned
                ? <PinOff className="h-4 w-4" />
                : <Pin className="h-4 w-4" />
              }
            </button>
          )}

          <button
            onClick={logout}
            data-testid={isMobile ? "button-logout-mobile" : "button-logout"}
            className="inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover-elevate active-elevate-2 transition-colors"
            title={t.auth.logout}
            aria-label={t.auth.logout}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
