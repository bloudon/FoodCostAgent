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
import logoImage from "@assets/FNB Cost Pro v1 (4)_1764653440689.png";
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
    <header className="sticky top-0 z-50 w-full border-b bg-primary text-primary-foreground shadow-sm">
      <div className="flex h-[70px] items-center justify-between pl-1 pr-4 sm:pr-6 gap-4">
        {/* Logo - fills left side with minimal padding */}
        <div className="flex items-center shrink-0">
          <img 
            src={logoImage} 
            alt="FNB Cost Pro" 
            className="h-[62px] w-auto"
            data-testid="logo"
          />
        </div>

        {/* Desktop: Company/Store + Navigation (Centered) */}
        <div className="hidden md:flex items-center gap-4 flex-1 justify-center">
          {/* Company Name and Store Selector */}
          <div className="flex items-center gap-3">
            {company && (
              <h2 className="text-base font-semibold whitespace-nowrap" data-testid="text-company-name">
                {company.name}
              </h2>
            )}
            {stores.length > 0 && (
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                <SelectTrigger className="w-[150px] h-10 bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/20" data-testid="select-store">
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

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            {/* Dashboard - no submenu */}
            <Link href="/" data-testid="link-dashboard">
              <Button
                variant="ghost"
                className={cn(
                  "h-10 px-4 py-2 text-base bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground",
                  location === "/" && "bg-primary-foreground/30"
                )}
              >
                <Home className="h-5 w-5 mr-2" />
                Dashboard
              </Button>
            </Link>

            {/* Dropdown menu sections */}
            {visibleSections.map((section) => {
              const sectionIcons = {
                'Menu': UtensilsCrossed,
                'Inventory': Warehouse,
                'Purchasing': ShoppingCart,
                'Reports': BarChart3,
                'Settings': Settings,
              };
              const SectionIcon = sectionIcons[section.title as keyof typeof sectionIcons];
              
              return (
                <DropdownMenu key={section.title}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex h-10 items-center justify-center rounded-md bg-primary-foreground/10 hover:bg-primary-foreground/20 px-4 py-2 text-base font-medium transition-colors focus:bg-primary-foreground/20 focus:outline-none disabled:pointer-events-none disabled:opacity-50 text-primary-foreground"
                      data-testid={`menu-${section.title.toLowerCase()}`}
                    >
                      {SectionIcon && <SectionIcon className="h-5 w-5 mr-2" />}
                      {section.title}
                      <svg className="ml-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              );
            })}
          </nav>
        </div>

        {/* User Controls - Desktop (Right aligned) */}
        <div className="hidden md:flex items-center gap-3">
          <span className="text-sm text-primary-foreground/80" data-testid="text-user-email">
            {user?.email}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground"
            onClick={logout}
            data-testid="button-logout"
          >
            <LogOut className="h-5 w-5" />
          </Button>
          <div className="bg-primary-foreground/10 hover:bg-primary-foreground/20 rounded-md">
            <ThemeToggle />
          </div>
        </div>

        {/* Mobile Menu - Right aligned */}
        <div className="flex md:hidden">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground" data-testid="button-mobile-menu">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 overflow-y-auto">
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
      </div>
    </header>
  );
}
