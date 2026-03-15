import { Link, useLocation } from "wouter";
import { useState } from "react";
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
  Menu,
  LogOut,
  Ruler,
} from "lucide-react";
const logoImage = "/logo.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useCompany } from "@/hooks/use-company";
import { useStoreContext } from "@/hooks/use-store-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { useTier } from "@/hooks/use-tier";
import { type Feature } from "@shared/tier-config";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NavItem {
  title: string;
  url: string;
  icon: any;
  requiresMultipleStores?: boolean;
  requiredFeature?: Feature;
}

interface NavSection {
  title: string;
  icon: any;
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

interface SettingsSection {
  title: string;
  icon: any;
  url?: string;
  children?: { title: string; url: string; icon: any }[];
}

const settingsSections: SettingsSection[] = [
  {
    title: "Locations",
    icon: MapPin,
    children: [
      { title: "Store Locations", url: "/stores", icon: Store },
      { title: "Storage Locations", url: "/storage-locations", icon: MapPin },
    ],
  },
  { title: "Categories", icon: Tag, url: "/categories" },
  { title: "Unit Conversions", icon: Ruler, url: "/unit-conversions" },
  { title: "API Credentials", icon: Key, url: "/api-credentials" },
  { title: "System", icon: Settings, url: "/settings" },
];

export function AppHeader() {
  const [location, navigate] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const { company } = useCompany();
  const { selectedStoreId, setSelectedStoreId, stores } = useStoreContext();
  const { data: accessibleStores, isLoading: storesLoading } = useAccessibleStores();

  const isStoreUser = user?.role === 'store_user';
  const hasMultipleStores = storesLoading ? true : (accessibleStores?.length ?? 0) >= 2;

  const isGlobalAdmin = user?.role === 'global_admin';
  const { hasFeature } = useTier();

  const getVisibleMainSections = () => {
    if (isGlobalAdmin && !company) return [];

    if (isStoreUser) {
      return mainNavSections
        .map(section => ({
          ...section,
          items: section.items.filter(item =>
            (item.title === 'Inventory Sessions' || item.title === 'Orders') &&
            (!item.requiredFeature || hasFeature(item.requiredFeature))
          )
        }))
        .filter(section => section.items.length > 0);
    }

    return mainNavSections.map(section => ({
      ...section,
      items: section.items.filter(item =>
        (!item.requiresMultipleStores || hasMultipleStores) &&
        (!item.requiredFeature || hasFeature(item.requiredFeature))
      )
    })).filter(section => section.items.length > 0);
  };

  const visibleMainSections = getVisibleMainSections();

  const userInitials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : user?.email?.[0]?.toUpperCase() || "U";

  const userName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email || "User";

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-primary text-primary-foreground shadow-sm">
      <div className="flex h-[56px] items-center gap-3 px-2 sm:px-4">
        <Link href="/" data-testid="link-dashboard-logo">
          <div className="flex items-center shrink-0 h-[56px] cursor-pointer">
            <img
              src={logoImage}
              alt="FNB Cost Pro"
              className="h-full w-auto"
              data-testid="logo"
            />
          </div>
        </Link>

        {company && stores.length > 0 && (
          <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
            <SelectTrigger
              className="w-[140px] sm:w-[160px] bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground"
              data-testid="select-store"
            >
              <Store className="h-4 w-4 mr-1.5 shrink-0" />
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id} data-testid={`select-store-${store.id}`}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex-1" />

        <div className="hidden md:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground"
                data-testid="button-main-menu"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Main menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              {visibleMainSections.map((section, sIdx) => (
                <DropdownMenuGroup key={section.title}>
                  {sIdx > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <section.icon className="h-4 w-4 text-muted-foreground" />
                    {section.title}
                  </DropdownMenuLabel>
                  {section.items.map((item) => (
                    <DropdownMenuItem
                      key={item.url}
                      className={cn(
                        "cursor-pointer pl-8",
                        location === item.url && "bg-accent"
                      )}
                      onClick={() => navigate(item.url)}
                      data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <item.icon className="h-4 w-4 mr-2" />
                      {item.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="md:hidden">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground"
                data-testid="button-mobile-menu"
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Main menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>

              <div className="mt-4 pb-4 border-b">
                {company && (
                  <div className="font-semibold mb-2" data-testid="text-company-name-mobile">
                    {company.name}
                  </div>
                )}
                {company && stores.length > 0 && (
                  <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                    <SelectTrigger className="w-full" data-testid="select-store-mobile">
                      <Store className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Select store" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                          {store.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="mt-4">
                <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant={location === "/" ? "secondary" : "ghost"}
                    className="w-full justify-start mb-1"
                    data-testid="link-dashboard-mobile"
                  >
                    <LayoutDashboard className="h-4 w-4 mr-2" />
                    Dashboard
                  </Button>
                </Link>

                <Accordion type="multiple" className="w-full">
                  {visibleMainSections.map((section) => (
                    <AccordionItem key={section.title} value={section.title}>
                      <AccordionTrigger className="text-sm font-semibold">
                        <span className="flex items-center gap-2">
                          <section.icon className="h-4 w-4" />
                          {section.title}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="flex flex-col space-y-1 pl-2">
                          {section.items.map((item) => (
                            <Link
                              key={item.url}
                              href={item.url}
                              onClick={() => setMobileMenuOpen(false)}
                            >
                              <Button
                                variant={location === item.url ? "secondary" : "ghost"}
                                className="w-full justify-start"
                                data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}-mobile`}
                              >
                                <item.icon className="h-4 w-4 mr-2" />
                                {item.title}
                              </Button>
                            </Link>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>

                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Settings</p>
                  {settingsSections.map((section) => {
                    if (isStoreUser || (isGlobalAdmin && !company)) return null;
                    if (section.children) {
                      return (
                        <Accordion key={section.title} type="multiple" className="w-full">
                          <AccordionItem value={section.title}>
                            <AccordionTrigger className="text-sm font-medium py-2">
                              <span className="flex items-center gap-2">
                                <section.icon className="h-4 w-4" />
                                {section.title}
                              </span>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="flex flex-col space-y-1 pl-2">
                                {section.children.map((child) => (
                                  <Link key={child.url} href={child.url} onClick={() => setMobileMenuOpen(false)}>
                                    <Button
                                      variant={location === child.url ? "secondary" : "ghost"}
                                      className="w-full justify-start"
                                    >
                                      <child.icon className="h-4 w-4 mr-2" />
                                      {child.title}
                                    </Button>
                                  </Link>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      );
                    }
                    return (
                      <Link key={section.title} href={section.url!} onClick={() => setMobileMenuOpen(false)}>
                        <Button
                          variant={location === section.url ? "secondary" : "ghost"}
                          className="w-full justify-start mb-1"
                        >
                          <section.icon className="h-4 w-4 mr-2" />
                          {section.title}
                        </Button>
                      </Link>
                    );
                  })}
                </div>

                <div className="mt-4 pt-4 border-t space-y-2">
                  <div className="flex items-center gap-3 px-2 mb-2">
                    <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
                      {userInitials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{userName}</p>
                      <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-2 mb-2">
                    <span className="text-sm">Theme</span>
                    <ThemeToggle />
                  </div>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={logout}
                    data-testid="button-logout-mobile"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {!isStoreUser && (!isGlobalAdmin || !!company) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground"
                data-testid="button-settings-menu"
              >
                <Settings className="h-5 w-5" />
                <span className="sr-only">Settings</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52" align="end">
              <DropdownMenuLabel>Settings</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {settingsSections.map((section) => {
                if (section.children) {
                  return (
                    <DropdownMenuSub key={section.title}>
                      <DropdownMenuSubTrigger data-testid={`menu-settings-${section.title.toLowerCase()}`}>
                        <section.icon className="h-4 w-4 mr-2" />
                        {section.title}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {section.children.map((child) => (
                          <DropdownMenuItem
                            key={child.url}
                            className={cn("cursor-pointer", location === child.url && "bg-accent")}
                            onClick={() => navigate(child.url)}
                            data-testid={`link-${child.title.toLowerCase().replace(/\s+/g, "-")}`}
                          >
                            <child.icon className="h-4 w-4 mr-2" />
                            {child.title}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                }
                return (
                  <DropdownMenuItem
                    key={section.title}
                    className={cn("cursor-pointer", location === section.url && "bg-accent")}
                    onClick={() => navigate(section.url!)}
                    data-testid={`link-${section.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <section.icon className="h-4 w-4 mr-2" />
                    {section.title}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-9 w-9 rounded-full bg-primary-foreground/15 text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0 hover:bg-primary-foreground/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="button-avatar-menu"
            >
              {userInitials}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1">
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
              className="cursor-pointer"
              onClick={logout}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
