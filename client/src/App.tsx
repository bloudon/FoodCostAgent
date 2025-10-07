import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import InventoryCount from "@/pages/inventory-count";
import CountSession from "@/pages/count-session";
import InventoryItems from "@/pages/inventory-items";
import Recipes from "@/pages/recipes";
import RecipeDetail from "@/pages/recipe-detail";
import Products from "@/pages/products";
import Vendors from "@/pages/vendors";
import PurchaseOrders from "@/pages/purchase-orders";
import Receiving from "@/pages/receiving";
import VarianceReport from "@/pages/variance-report";
import StorageLocations from "@/pages/storage-locations";
import Settings from "@/pages/settings";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/inventory-items" component={InventoryItems} />
      <Route path="/inventory" component={InventoryCount} />
      <Route path="/count/:id" component={CountSession} />
      <Route path="/recipes/:id" component={RecipeDetail} />
      <Route path="/recipes" component={Recipes} />
      <Route path="/products" component={Products} />
      <Route path="/vendors" component={Vendors} />
      <Route path="/purchase-orders" component={PurchaseOrders} />
      <Route path="/receiving" component={Receiving} />
      <Route path="/variance" component={VarianceReport} />
      <Route path="/storage-locations" component={StorageLocations} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1">
                <header className="flex items-center justify-between p-4 border-b sticky top-0 bg-background z-10">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex items-center gap-2">
                    <ThemeToggle />
                  </div>
                </header>
                <main className="flex-1 overflow-auto">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
