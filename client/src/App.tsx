import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import InventorySessions from "@/pages/inventory-sessions";
import CountSession from "@/pages/count-session";
import ItemCount from "@/pages/item-count";
import InventoryItems from "@/pages/inventory-items";
import InventoryItemDetail from "@/pages/inventory-item-detail";
import InventoryItemCreate from "@/pages/inventory-item-create";
import Recipes from "@/pages/recipes";
import RecipeDetail from "@/pages/recipe-detail";
import UnitConversions from "@/pages/unit-conversions";
import Vendors from "@/pages/vendors";
import PurchaseOrders from "@/pages/purchase-orders";
import Receiving from "@/pages/receiving";
import VarianceReport from "@/pages/variance-report";
import StorageLocations from "@/pages/storage-locations";
import Settings from "@/pages/settings";
import Login from "@/pages/login";

function ProtectedLayout() {
  const { user, isLoading, logout } = useAuth();
  const [location, setLocation] = useLocation();

  // Use useEffect for navigation to avoid setState during render
  useEffect(() => {
    if (!isLoading && !user && location !== "/login") {
      setLocation("/login");
    }
  }, [isLoading, user, location, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-lg">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between p-4 border-b sticky top-0 bg-background z-10">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground mr-2" data-testid="text-user-email">
                {user.email}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                data-testid="button-logout"
              >
                <LogOut className="h-5 w-5" />
              </Button>
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/inventory-items" component={InventoryItems} />
              <Route path="/inventory-items/new" component={InventoryItemCreate} />
              <Route path="/inventory-items/:id" component={InventoryItemDetail} />
              <Route path="/inventory-sessions" component={InventorySessions} />
              <Route path="/count/:id" component={CountSession} />
              <Route path="/item-count/:id" component={ItemCount} />
              <Route path="/recipes/:id" component={RecipeDetail} />
              <Route path="/recipes" component={Recipes} />
              <Route path="/vendors" component={Vendors} />
              <Route path="/purchase-orders" component={PurchaseOrders} />
              <Route path="/receiving" component={Receiving} />
              <Route path="/variance" component={VarianceReport} />
              <Route path="/storage-locations" component={StorageLocations} />
              <Route path="/unit-conversions" component={UnitConversions} />
              <Route path="/settings" component={Settings} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <AuthProvider>
            <Switch>
              <Route path="/login" component={Login} />
              <Route>
                <ProtectedLayout />
              </Route>
            </Switch>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
