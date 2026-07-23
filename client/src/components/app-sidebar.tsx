import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  ClipboardList,
  ShoppingCart,
  ChefHat,
  BarChart3,
  MoreHorizontal,
  Store,
  LogOut,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/lib/auth-context";
import { useAppLanguage } from "@/lib/language-context";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useCompany } from "@/hooks/use-company";
import { useStoreContext } from "@/hooks/use-store-context";

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
    loc.startsWith("/new-count") ||
    loc.startsWith("/item-count") ||
    loc.startsWith("/shelf-scans") ||
    loc === "/waste" ||
    loc.startsWith("/waste/") ||
    loc.startsWith("/prep-chart/on-hand")
  ) return "count";

  if (
    loc.startsWith("/orders") ||
    loc.startsWith("/purchase-orders") ||
    loc.startsWith("/vendors") ||
    loc.startsWith("/receiving") ||
    loc.startsWith("/transfer-orders") ||
    loc.startsWith("/order-guide")
  ) return "order";

  if (loc.startsWith("/prep-chart") && !loc.startsWith("/prep-chart/on-hand")) return "prep";

  if (
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
  /** Roles that may see this item. Undefined = visible to all. */
  roles?: string[];
  testId: string;
}

const RAIL: RailItem[] = [
  {
    id: "home",
    label: "Home",
    icon: LayoutDashboard,
    href: "/",
    testId: "nav-home",
  },
  {
    id: "count",
    label: "Count",
    icon: ClipboardList,
    href: "/count",
    testId: "nav-count",
  },
  {
    id: "order",
    label: "Order",
    icon: ShoppingCart,
    href: "/orders",
    roles: ["store_manager", "company_admin", "global_admin"],
    testId: "nav-order",
  },
  {
    id: "prep",
    label: "Prep",
    icon: ChefHat,
    href: "/prep-chart",
    testId: "nav-prep",
  },
  {
    id: "analyze",
    label: "Analyze",
    icon: BarChart3,
    href: "/tfc/variance",
    roles: ["store_manager", "company_admin", "global_admin"],
    testId: "nav-analyze",
  },
  {
    id: "more",
    label: "More",
    icon: MoreHorizontal,
    href: "/settings",
    testId: "nav-more",
  },
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
  const { data: accessibleStores, isLoading: storesLoading } = useAccessibleStores();
  const { isMobile, setOpenMobile } = useSidebar();
  const { theme } = useTheme();

  const logoImage = theme === "dark" ? "/website-logo-dark.png" : "/website-logo.png";
  const role = user?.role ?? "store_user";
  const isGlobalAdmin = role === "global_admin";

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const activeSection = getActiveSection(location);

  // Filter visible rail items by role.
  // Global admin without a company selected shows a minimal rail — the
  // ProtectedLayout redirect to /companies handles the primary flow.
  const visibleItems = RAIL.filter((item) => {
    if (isGlobalAdmin && !company && item.id !== "home" && item.id !== "more") return false;
    if (item.roles && !item.roles.includes(role)) return false;
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

  return (
    <Sidebar collapsible="icon">
      {/* ── Header: logo + store selector ── */}
      <SidebarHeader className="border-b pb-3">
        <div className="flex items-center justify-center px-3 pt-2">
          <Link
            href="/"
            onClick={closeMobile}
            data-testid="link-dashboard-logo"
            className="flex w-full items-center justify-center group-data-[collapsible=icon]:justify-center"
          >
            <img
              src={logoImage}
              alt="FNB Cost Pro"
              className="w-full max-h-12 object-contain group-data-[collapsible=icon]:hidden"
              data-testid="logo"
            />
            <img
              src={logoImage}
              alt="FNB Cost Pro"
              className="hidden h-7 w-auto object-contain group-data-[collapsible=icon]:block"
              data-testid="logo-collapsed"
            />
          </Link>
        </div>

        {company && isMobile && (
          <div
            className="font-semibold text-sm px-1 pb-0.5 truncate group-data-[collapsible=icon]:hidden"
            data-testid="text-company-name-mobile"
          >
            {company.name}
          </div>
        )}

        {company && stores.length > 0 && (
          <>
            <div className="group-data-[collapsible=icon]:hidden">
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
            </div>
            <div className="hidden group-data-[collapsible=icon]:flex justify-center py-0.5">
              <Store className="h-4 w-4 text-sidebar-foreground/60" />
            </div>
          </>
        )}
      </SidebarHeader>

      {/* ── Content: flat rail ── */}
      <SidebarContent>
        <SidebarMenu className="gap-0.5 px-2 py-2">
          {visibleItems.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                asChild
                isActive={activeSection === item.id}
                tooltip={item.label}
                data-testid={isMobile ? `${item.testId}-mobile` : item.testId}
                className="gap-3"
              >
                <Link href={item.href} onClick={closeMobile}>
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      {/* ── Footer: user + controls ── */}
      <SidebarFooter className="border-t p-2 space-y-1">
        <div className="flex items-center gap-2 px-1 py-1 group-data-[collapsible=icon]:hidden">
          <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
            {userInitials}
          </div>
          <div className="flex-1 min-w-0 text-left text-sm leading-tight">
            <p className="truncate font-semibold">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center">
          <div className="hidden group-data-[collapsible=icon]:flex h-7 w-7 rounded-full bg-primary text-primary-foreground items-center justify-center text-xs font-semibold mb-1">
            {userInitials}
          </div>

          <div className="flex-1 group-data-[collapsible=icon]:hidden" />

          <ThemeToggle />
          <LanguageToggle />

          <button
            onClick={logout}
            data-testid={isMobile ? "button-logout-mobile" : "button-logout"}
            className="inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover-elevate active-elevate-2 transition-colors"
            title={t.auth.logout}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
