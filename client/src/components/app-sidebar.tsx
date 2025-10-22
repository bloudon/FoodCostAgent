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
  },
  {
    title: "Variance Report",
    url: "/variance",
    icon: BarChart3,
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

  // Store level users should only see Dashboard, Inventory Sessions and Orders
  const isStoreUser = user?.role === 'store_user';
  
  // Filter menu items based on user role
  const visibleMenuItems = isStoreUser 
    ? menuItems.filter(item => 
        item.title === 'Dashboard' || item.title === 'Inventory Sessions' || item.title === 'Orders'
      )
    : menuItems;

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
