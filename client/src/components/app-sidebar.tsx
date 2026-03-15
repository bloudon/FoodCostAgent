import { Link, useLocation } from "wouter";
import {
  Package,
  Users,
  ChefHat,
  ClipboardList,
  ShoppingCart,
  PackageCheck,
  BarChart3,
  Home,
  MapPin,
  Warehouse,
  Settings,
  ArrowLeftRight,
  Tag,
  Store,
  Key,
  UtensilsCrossed,
  Trash2,
  Upload,
  DollarSign,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useTier } from "@/hooks/use-tier";
import { type Feature } from "@shared/tier-config";

interface MenuItem {
  title: string;
  url: string;
  icon: any;
  requiresMultipleStores?: boolean;
  requiredFeature?: Feature;
}

const menuItems: MenuItem[] = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Inventory Items",
    url: "/inventory-items",
    icon: Warehouse,
  },
  {
    title: "Inventory Sessions",
    url: "/inventory-sessions",
    icon: ClipboardList,
    requiredFeature: "power_inventory",
  },
  {
    title: "Recipes",
    url: "/recipes",
    icon: ChefHat,
    requiredFeature: "recipe_costing",
  },
  {
    title: "Menu Items",
    url: "/menu-items",
    icon: UtensilsCrossed,
    requiredFeature: "recipe_costing",
  },
  {
    title: "Vendors",
    url: "/vendors",
    icon: Users,
  },
  {
    title: "Orders",
    url: "/orders",
    icon: ShoppingCart,
  },
  {
    title: "Transfer Orders",
    url: "/transfer-orders",
    icon: ArrowLeftRight,
    requiresMultipleStores: true,
    requiredFeature: "transfer_orders",
  },
  {
    title: "Waste Entry",
    url: "/waste",
    icon: Trash2,
  },
];

const foodCostItems: MenuItem[] = [
  {
    title: "Sales Import",
    url: "/tfc/sales-import",
    icon: Upload,
    requiredFeature: "pos_import",
  },
  {
    title: "Food Cost Variance",
    url: "/tfc/variance",
    icon: DollarSign,
    requiredFeature: "tfc_variance",
  },
];

const settingsItems = [
  {
    title: "Store Locations",
    url: "/stores",
    icon: Store,
  },
  {
    title: "Storage Locations",
    url: "/storage-locations",
    icon: MapPin,
  },
  {
    title: "Categories",
    url: "/categories",
    icon: Tag,
  },
  {
    title: "Unit Conversions",
    url: "/unit-conversions",
    icon: ArrowLeftRight,
  },
  {
    title: "API Credentials",
    url: "/api-credentials",
    icon: Key,
  },
  {
    title: "System",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { data: accessibleStores, isLoading: storesLoading } = useAccessibleStores();
  const { hasFeature } = useTier();

  const isStoreUser = user?.role === 'store_user';
  
  const hasMultipleStores = storesLoading ? true : (accessibleStores?.length ?? 0) >= 2;
  
  const visibleMenuItems = isStoreUser 
    ? menuItems.filter(item => 
        (item.title === 'Dashboard' || item.title === 'Inventory Sessions' || item.title === 'Orders') &&
        (!item.requiredFeature || hasFeature(item.requiredFeature))
      )
    : menuItems.filter(item => 
        (!item.requiresMultipleStores || hasMultipleStores) &&
        (!item.requiredFeature || hasFeature(item.requiredFeature))
      );

  const visibleFoodCostItems = foodCostItems.filter(item =>
    !item.requiredFeature || hasFeature(item.requiredFeature)
  );

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Restaurant Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!isStoreUser && visibleFoodCostItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Food Cost Management</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleFoodCostItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        
        {!isStoreUser && (
          <SidebarGroup>
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {settingsItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
