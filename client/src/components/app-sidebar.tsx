import { Link, useLocation } from "wouter";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  ShoppingCart,
  ChefHat,
  UtensilsCrossed,
  BarChart3,
  MoreHorizontal,
  Pin,
  PinOff,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/lib/auth-context";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useCompany } from "@/hooks/use-company";
import { useTier } from "@/hooks/use-tier";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 300;
const EXPANDED_WIDTH = "180px";

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

  if (
    loc === "/menu-items" || loc.startsWith("/menu-items/") ||
    loc === "/menus" || loc.startsWith("/menus/") ||
    loc === "/menu-scan" || loc.startsWith("/menu-scan/") ||
    loc === "/recipes" || loc.startsWith("/recipes/") ||
    loc.startsWith("/recipe")
  ) return "menu";

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
  { id: "home",      label: "Home",      icon: LayoutDashboard,  href: "/",           testId: "nav-home" },
  { id: "count",     label: "Inventory", icon: ClipboardList,    href: "/count",      testId: "nav-count" },
  { id: "order",     label: "Order",     icon: ShoppingCart,     href: "/order",      roles: ["store_manager", "company_admin", "global_admin"], testId: "nav-order" },
  { id: "prep",      label: "Prep",      icon: ChefHat,          href: "/prep",       testId: "nav-prep" },
  { id: "menu",      label: "Menus",     icon: UtensilsCrossed,  href: "/menu-items", testId: "nav-menu" },
  { id: "analyze",   label: "Analyze",   icon: BarChart3,        href: "/analyze",    roles: ["store_manager", "company_admin", "global_admin"], testId: "nav-analyze" },
  { id: "more",      label: "More",      icon: MoreHorizontal,   href: "/more",       testId: "nav-more" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { company } = useCompany();
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
  const logoFull = theme === "dark" ? "/website-logo-dark.png" : "/website-logo.png";
  const logoIcon = "/android-chrome-192x192.png";
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
                src={logoFull}
                alt="FNB Cost Pro"
                className="w-full max-h-12 object-contain"
                data-testid="logo"
              />
            ) : (
              <img
                src={logoIcon}
                alt="FNB Cost Pro"
                className="h-10 w-10 object-contain"
                data-testid="logo-collapsed"
              />
            )}
          </Link>
        </div>

      </SidebarHeader>

      {/* ── Content: flat rail ───────────────────────────────────────────── */}
      <SidebarContent>
        <SidebarMenu className="gap-0.5 px-1 py-2">
          {visibleItems.map((item) => {
            const active = activeSection === item.id;

            const linkEl = (
              <Link
                href={item.href}
                onClick={closeMobile}
                data-testid={isMobile ? `${item.testId}-mobile` : item.testId}
                className={cn(
                  "flex items-center rounded-md transition-colors w-full",
                  "text-sidebar-foreground",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                  isExpanded ? "gap-3 px-3 py-2" : "justify-center py-3 px-0"
                )}
              >
                <item.icon className="h-12 w-12 shrink-0" />
                {isExpanded ? (
                  <span className={cn("text-sm font-medium", active && "font-semibold")}>
                    {item.label}
                  </span>
                ) : (
                  <span className="sr-only">{item.label}</span>
                )}
              </Link>
            );

            return (
              <SidebarMenuItem key={item.id}>
                {!isExpanded ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : linkEl}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      {/* ── Footer: pin control only (user/theme/logout live in the top bar) ── */}
      {!isMobile && (
        <SidebarFooter className="border-t p-2">
          <div className="flex justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={togglePin}
                  className="inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover-elevate active-elevate-2 transition-colors"
                  data-testid="button-sidebar-pin"
                  aria-label={isPinned ? "Unpin sidebar" : "Pin sidebar"}
                >
                  {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {isPinned ? "Unpin sidebar" : "Pin sidebar"}
              </TooltipContent>
            </Tooltip>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
