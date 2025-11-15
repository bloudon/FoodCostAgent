import { Link, useLocation } from "wouter";
import { useState } from "react";
import {
  Home,
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
  X,
  LogOut,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navigationSections: NavSection[] = [
  {
    title: "Menu",
    items: [
      { title: "Menu Items", url: "/menu-items", icon: UtensilsCrossed },
      { title: "Recipes", url: "/recipes", icon: ChefHat },
    ],
  },
  {
    title: "Inventory",
    items: [
      { title: "Inventory Items", url: "/inventory-items", icon: Warehouse },
      { title: "Inventory Sessions", url: "/inventory-sessions", icon: ClipboardList },
      { title: "Waste Entry", url: "/waste", icon: Trash2 },
    ],
  },
  {
    title: "Purchasing",
    items: [
      { title: "Orders", url: "/orders", icon: ShoppingCart },
      { title: "Vendors", url: "/vendors", icon: Users },
      { title: "Transfer Orders", url: "/transfer-orders", icon: ArrowLeftRight, requiresMultipleStores: true },
    ],
  },
  {
    title: "Reports",
    items: [
      { title: "Sales Import", url: "/tfc/sales-import", icon: Upload },
      { title: "Variance Report", url: "/tfc/variance", icon: BarChart3 },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Store Locations", url: "/stores", icon: Store },
      { title: "Storage Locations", url: "/storage-locations", icon: MapPin },
      { title: "Categories", url: "/categories", icon: Tag },
      { title: "Unit Conversions", url: "/unit-conversions", icon: ArrowLeftRight },
      { title: "API Credentials", url: "/api-credentials", icon: Key },
      { title: "System", url: "/settings", icon: Settings },
    ],
  },
];

export function AppHeader() {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const { company } = useCompany();
  const { selectedStoreId, setSelectedStoreId, stores } = useStoreContext();
  const { data: accessibleStores, isLoading: storesLoading } = useAccessibleStores();

  // Store level users should only see Dashboard, Inventory Sessions and Orders
  const isStoreUser = user?.role === 'store_user';
  
  // Hide transfer-related items for companies with less than 2 stores
  const hasMultipleStores = storesLoading ? true : (accessibleStores?.length ?? 0) >= 2;

  // Filter sections based on user role and store count
  const getVisibleSections = () => {
    if (isStoreUser) {
      // Store users only see Dashboard (separate), Inventory Sessions, and Orders
      return navigationSections
        .map(section => ({
          ...section,
          items: section.items.filter(item => 
            item.title === 'Inventory Sessions' || item.title === 'Orders'
          )
        }))
        .filter(section => section.items.length > 0);
    }
    
    return navigationSections.map(section => ({
      ...section,
      items: section.items.filter(item => 
        !item.requiresMultipleStores || hasMultipleStores
      )
    }));
  };

  const visibleSections = getVisibleSections();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-12 items-center px-4 sm:px-6 gap-3">
        {/* Mobile Menu */}
        <div className="flex md:hidden">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              
              {/* Company/Store Info in Mobile */}
              <div className="mt-4 pb-4 border-b">
                {company && (
                  <div className="font-semibold mb-2" data-testid="text-company-name">
                    {company.name}
                  </div>
                )}
                {stores.length > 0 && (
                  <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                    <SelectTrigger className="w-full" data-testid="select-store">
                      <Store className="h-4 w-4 mr-2" />
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
              </div>
              
              <div className="mt-6">
                {/* Dashboard - always visible */}
                <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                  <Button
                    variant={location === "/" ? "default" : "ghost"}
                    className="w-full justify-start mb-2"
                    data-testid="link-dashboard"
                  >
                    <Home className="h-4 w-4 mr-2" />
                    Dashboard
                  </Button>
                </Link>

                {/* Accordion for sections */}
                <Accordion type="multiple" className="w-full">
                  {visibleSections.map((section) => (
                    <AccordionItem key={section.title} value={section.title}>
                      <AccordionTrigger className="text-sm font-semibold uppercase tracking-wider">
                        {section.title}
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="flex flex-col space-y-1">
                          {section.items.map((item) => (
                            <Link
                              key={item.url}
                              href={item.url}
                              onClick={() => setMobileMenuOpen(false)}
                            >
                              <Button
                                variant={location === item.url ? "default" : "ghost"}
                                className="w-full justify-start"
                                data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
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
                
                {/* User Controls in Mobile */}
                <div className="mt-6 pt-4 border-t space-y-2">
                  <div className="text-sm text-muted-foreground mb-2" data-testid="text-user-email">
                    {user?.email}
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Theme</span>
                    <ThemeToggle />
                  </div>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={logout}
                    data-testid="button-logout"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Company Name and Store Selector - Desktop */}
        <div className="hidden md:flex items-center gap-3">
          {company && (
            <h2 className="text-base font-semibold whitespace-nowrap" data-testid="text-company-name">
              {company.name}
            </h2>
          )}
          {stores.length > 0 && (
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger className="w-[140px] h-9" data-testid="select-store">
                <Store className="h-4 w-4 mr-2" />
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
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {/* Dashboard - no submenu */}
          <Link href="/" data-testid="link-dashboard">
            <Button
              variant="ghost"
              className={cn(
                "h-9 px-3 py-2",
                location === "/" && "bg-accent"
              )}
            >
              <Home className="h-4 w-4 mr-2" />
              Dashboard
            </Button>
          </Link>

          {/* Dropdown menu sections */}
          {visibleSections.map((section) => (
            <DropdownMenu key={section.title}>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex h-9 items-center justify-center rounded-md bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                  data-testid={`menu-${section.title.toLowerCase()}`}
                >
                  {section.title}
                  <svg className="ml-1 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="start">
                {section.items.map((item) => (
                  <DropdownMenuItem key={item.url} asChild>
                    <Link
                      href={item.url}
                      className="flex items-center gap-3 cursor-pointer"
                      data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User Controls - Desktop */}
        <div className="hidden md:flex items-center gap-2">
          <span className="text-sm text-muted-foreground" data-testid="text-user-email">
            {user?.email}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={logout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
