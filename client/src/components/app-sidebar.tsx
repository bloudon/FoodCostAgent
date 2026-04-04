import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ChefHat,
  Warehouse,
  ClipboardList,
  Trash2,
  ShoppingCart,
  Users,
  ArrowLeftRight,
  Upload,
  BarChart3,
  Store,
  MapPin,
  Tag,
  Settings,
  Key,
  LogOut,
  Ruler,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth-context";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useCompany } from "@/hooks/use-company";
import { useStoreContext } from "@/hooks/use-store-context";
import { useTier } from "@/hooks/use-tier";
import { type Feature } from "@shared/tier-config";

const logoImage = "/website-logo.png";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresMultipleStores?: boolean;
  requiredFeature?: Feature;
}

interface NavSection {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

const mainNavSections: NavSection[] = [
  {
    title: "Menu",
    icon: UtensilsCrossed,
    items: [
      { title: "Menu Items", url: "/menu-items", icon: UtensilsCrossed, requiredFeature: "recipe_costing" },
      { title: "Recipes", url: "/recipes", icon: ChefHat, requiredFeature: "recipe_costing" },
    ],
  },
  {
    title: "Inventory",
    icon: Warehouse,
    items: [
      { title: "Inventory Items", url: "/inventory-items", icon: Warehouse },
      { title: "Categories", url: "/categories", icon: Tag },
      { title: "Inventory Sessions", url: "/inventory-sessions", icon: ClipboardList, requiredFeature: "power_inventory" },
      { title: "Waste Entry", url: "/waste", icon: Trash2 },
    ],
  },
  {
    title: "Purchasing",
    icon: ShoppingCart,
    items: [
      { title: "Orders", url: "/orders", icon: ShoppingCart },
      { title: "Vendors", url: "/vendors", icon: Users },
      { title: "Transfer Orders", url: "/transfer-orders", icon: ArrowLeftRight, requiresMultipleStores: true, requiredFeature: "transfer_orders" },
    ],
  },
  {
    title: "Reports",
    icon: BarChart3,
    items: [
      { title: "Sales Import", url: "/tfc/sales-import", icon: Upload, requiredFeature: "pos_import" },
      { title: "Variance Report", url: "/tfc/variance", icon: BarChart3, requiredFeature: "tfc_variance" },
    ],
  },
];

const settingsItems = [
  { title: "Store Locations", url: "/stores", icon: Store },
  { title: "Storage Locations", url: "/storage-locations", icon: MapPin },
  { title: "Categories", url: "/categories", icon: Tag },
  { title: "Unit Conversions", url: "/unit-conversions", icon: Ruler },
  { title: "API Credentials", url: "/api-credentials", icon: Key },
  { title: "System", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { company } = useCompany();
  const { selectedStoreId, setSelectedStoreId, stores } = useStoreContext();
  const { data: accessibleStores, isLoading: storesLoading } = useAccessibleStores();
  const { hasFeature } = useTier();
  const { state, isMobile } = useSidebar();

  const isStoreUser = user?.role === "store_user";
  const isGlobalAdmin = user?.role === "global_admin";
  const hasMultipleStores = storesLoading ? true : (accessibleStores?.length ?? 0) >= 2;

  const getVisibleSections = (): NavSection[] => {
    if (isGlobalAdmin && !company) return [];
    if (isStoreUser) {
      return mainNavSections
        .map((section) => ({
          ...section,
          items: section.items.filter(
            (item) =>
              (item.title === "Inventory Sessions" || item.title === "Orders") &&
              (!item.requiredFeature || hasFeature(item.requiredFeature))
          ),
        }))
        .filter((section) => section.items.length > 0);
    }
    return mainNavSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            (!item.requiresMultipleStores || hasMultipleStores) &&
            (!item.requiredFeature || hasFeature(item.requiredFeature))
        ),
      }))
      .filter((section) => section.items.length > 0);
  };

  const visibleSections = getVisibleSections();
  const showSettings = !isStoreUser && (!isGlobalAdmin || !!company);

  const isSectionActive = (section: NavSection) =>
    section.items.some(
      (item) => location === item.url || location.startsWith(item.url + "/")
    );

  const isSettingsActive = settingsItems.some(
    (item) => location === item.url
  );

  const userInitials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
      : user?.email?.[0]?.toUpperCase() || "U";

  const userName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email || "User";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b pb-3">
        <div className="flex items-center gap-2 px-1 pt-1">
          <Link href="/" data-testid="link-dashboard-logo">
            <img
              src={logoImage}
              alt="FNB Cost Pro"
              className="h-8 w-auto group-data-[collapsible=icon]:hidden"
              data-testid="logo"
            />
            <img
              src={logoImage}
              alt="FNB Cost Pro"
              className="hidden h-6 w-auto group-data-[collapsible=icon]:block"
              data-testid="logo-collapsed"
            />
          </Link>
          {/* Mobile-only trigger inside the sidebar itself, for backward-compat testid */}
          <SidebarTrigger
            className="ml-auto md:hidden"
            data-testid="button-mobile-menu"
          />
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

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location === "/"}
                  tooltip="Dashboard"
                  data-testid={isMobile ? "link-dashboard-mobile" : "link-dashboard"}
                >
                  <Link href="/">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleSections.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleSections.map((section) => (
                  <Collapsible
                    key={section.title}
                    asChild
                    defaultOpen={isSectionActive(section)}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          tooltip={section.title}
                          data-testid={`nav-section-${section.title.toLowerCase()}`}
                        >
                          <section.icon className="h-4 w-4" />
                          <span>{section.title}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {section.items.map((item) => {
                            const slug = item.title.toLowerCase().replace(/\s+/g, "-");
                            return (
                              <SidebarMenuSubItem key={item.url}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={
                                    location === item.url ||
                                    location.startsWith(item.url + "/")
                                  }
                                  data-testid={isMobile ? `link-${slug}-mobile` : `link-${slug}`}
                                >
                                  <Link href={item.url}>
                                    <item.icon className="h-3.5 w-3.5" />
                                    <span>{item.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showSettings && (
          <SidebarGroup className="mt-auto">
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible
                  asChild
                  defaultOpen={isSettingsActive}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip="Settings"
                        data-testid="button-settings-menu"
                      >
                        <Settings className="h-4 w-4" />
                        <span>Settings</span>
                        <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {settingsItems.map((item) => {
                          const slug = item.title.toLowerCase().replace(/\s+/g, "-");
                          // Store Locations was grouped under a "Locations" sub-trigger in the
                          // old header (data-testid="menu-settings-locations"). On desktop,
                          // preserve that testid for backward compat.
                          const testId =
                            !isMobile && item.title === "Store Locations"
                              ? "menu-settings-locations"
                              : `link-${slug}`;
                          return (
                            <SidebarMenuSubItem key={item.url}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location === item.url}
                                data-testid={testId}
                              >
                                <Link href={item.url}>
                                  <item.icon className="h-3.5 w-3.5" />
                                  <span>{item.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

      </SidebarContent>

      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  data-testid="button-avatar-menu"
                  tooltip={userName}
                >
                  <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                    {userInitials}
                  </div>
                  <div className="grid flex-1 min-w-0 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{userName}</span>
                    <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side={state === "collapsed" ? "right" : "top"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium">{userName}</p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="text-sm">Theme</span>
                  <ThemeToggle />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  data-testid={isMobile ? "button-logout-mobile" : "button-logout"}
                  className="cursor-pointer"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
