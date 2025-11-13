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

const menuItems = [
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
  },
  {
    title: "Recipes",
    url: "/recipes",
    icon: ChefHat,
  },
  {
    title: "Menu Items",
    url: "/menu-items",
    icon: UtensilsCrossed,
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
  },
  {
    title: "Waste Entry",
    url: "/waste",
    icon: Trash2,
  },
];

const foodCostItems = [
  {
    title: "Sales Import",
    url: "/tfc/sales-import",
    icon: Upload,
  },
  {
    title: "Food Cost Variance",
    url: "/tfc/variance",
    icon: DollarSign,
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

  // Store level users should only see Dashboard, Inventory Sessions and Orders
  const isStoreUser = user?.role === 'store_user';
  
  // Hide transfer-related items for companies with less than 2 stores
  // Show all items while loading to prevent flicker for multi-store users
  const hasMultipleStores = storesLoading ? true : (accessibleStores?.length ?? 0) >= 2;
  
  // Filter menu items based on user role and store count
  const visibleMenuItems = isStoreUser 
    ? menuItems.filter(item => 
        item.title === 'Dashboard' || item.title === 'Inventory Sessions' || item.title === 'Orders'
      )
    : menuItems.filter(item => 
        !item.requiresMultipleStores || hasMultipleStores
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

        {!isStoreUser && (
          <SidebarGroup>
            <SidebarGroupLabel>Food Cost Management</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {foodCostItems.map((item) => (
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
