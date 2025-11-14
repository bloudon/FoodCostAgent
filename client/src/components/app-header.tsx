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
  const { user } = useAuth();
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
      <div className="flex h-14 items-center px-4 sm:px-6">
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
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {/* Dashboard - no submenu */}
          <Link href="/" data-testid="link-dashboard">
            <Button
              variant="ghost"
              className={cn(
                "h-10 px-4 py-2",
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
                  className="inline-flex h-10 items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50"
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
      </div>
    </header>
  );
}
