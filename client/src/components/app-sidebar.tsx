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

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Inventory Count",
    url: "/inventory",
    icon: ClipboardList,
  },
  {
    title: "Storage Locations",
    url: "/storage-locations",
    icon: MapPin,
  },
  {
    title: "Recipes",
    url: "/recipes",
    icon: ChefHat,
  },
  {
    title: "Products",
    url: "/products",
    icon: Package,
  },
  {
    title: "Vendors",
    url: "/vendors",
    icon: Users,
  },
  {
    title: "Purchase Orders",
    url: "/purchase-orders",
    icon: ShoppingCart,
  },
  {
    title: "Receiving",
    url: "/receiving",
    icon: PackageCheck,
  },
  {
    title: "Variance Report",
    url: "/variance",
    icon: BarChart3,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Restaurant Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
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
      </SidebarContent>
    </Sidebar>
  );
}
