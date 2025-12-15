import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppHeader } from "@/components/app-header";
import { GlobalAdminHeader } from "@/components/global-admin-header";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut, Store } from "lucide-react";
import { StoreProvider, useStoreContext } from "@/hooks/use-store-context";
import { useCompany } from "@/hooks/use-company";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import InventorySessions from "@/pages/inventory-sessions";
import InventoryCount from "@/pages/inventory-count";
import CountSession from "@/pages/count-session";
import ItemCount from "@/pages/item-count";
import InventoryItems from "@/pages/inventory-items";
import InventoryItemDetail from "@/pages/inventory-item-detail";
import InventoryItemCreate from "@/pages/inventory-item-create";
import MenuItems from "@/pages/menu-items";
import Recipes from "@/pages/recipes";
import RecipeBuilder from "@/pages/recipe-builder";
import RecipeDetail from "@/pages/recipe-detail";
import UnitConversions from "@/pages/unit-conversions";
import Vendors from "@/pages/vendors";
import VendorDetail from "@/pages/vendor-detail";
import OrderGuideReview from "@/pages/order-guide-review";
import Orders from "@/pages/orders";
import PurchaseOrders from "@/pages/purchase-orders";
import PurchaseOrderDetail from "@/pages/purchase-order-detail";
import ReceivingDetail from "@/pages/receiving-detail";
import TransferOrders from "@/pages/transfer-orders";
import TransferOrderDetail from "@/pages/transfer-order-detail";
import VarianceReport from "@/pages/variance-report";
import StorageLocations from "@/pages/storage-locations";
import Categories from "@/pages/categories";
import ApiCredentials from "@/pages/api-credentials";
import Settings from "@/pages/settings";
import Companies from "@/pages/companies";
import CompanyDetail from "@/pages/company-detail";
import Stores from "@/pages/stores";
import Users from "@/pages/users";
import WasteEntry from "@/pages/waste-entry";
import TfcSalesImport from "@/pages/tfc-sales-import";
import TfcVariance from "@/pages/tfc-variance";
import Login from "@/pages/login";
import PendingApproval from "@/pages/pending-approval";
import SsoAccessDenied from "@/pages/sso-access-denied";
import AcceptInvitation from "@/pages/accept-invitation";
import Onboarding from "@/pages/onboarding";

function ProtectedLayout() {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user && location !== "/login") {
      setLocation("/login");
    }
    
    if (!isLoading && user && user.role === "global_admin") {
      const selectedCompanyId = localStorage.getItem("selectedCompanyId");
      const isOnCompaniesPage = location === "/companies" || location.startsWith("/companies/");
      if (!selectedCompanyId && !isOnCompaniesPage) {
        setLocation("/companies");
      }
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

  return (
    <StoreProvider>
      <ProtectedLayoutContent />
    </StoreProvider>
  );
}

function ProtectedLayoutContent() {
  const { user, logout } = useAuth();
  const { company } = useCompany();
  const { selectedStoreId, setSelectedStoreId, stores } = useStoreContext();

  const isGlobalAdmin = user?.role === "global_admin";

  return (
    <div className="flex flex-col h-screen w-full">
      {isGlobalAdmin && <GlobalAdminHeader />}
      
      {/* Compact Combined Header */}
      <AppHeader />

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/companies/:id" component={CompanyDetail} />
              <Route path="/companies" component={Companies} />
              <Route path="/stores" component={Stores} />
              <Route path="/users" component={Users} />
              <Route path="/inventory-items" component={InventoryItems} />
              <Route path="/inventory-items/new" component={InventoryItemCreate} />
              <Route path="/inventory-items/:id" component={InventoryItemDetail} />
              <Route path="/menu-items" component={MenuItems} />
              <Route path="/inventory-sessions" component={InventorySessions} />
              <Route path="/inventory-count" component={InventoryCount} />
              <Route path="/count/:id" component={CountSession} />
              <Route path="/item-count/:id" component={ItemCount} />
              <Route path="/recipes/new" component={RecipeBuilder} />
              <Route path="/recipes/:id/edit" component={RecipeBuilder} />
              <Route path="/recipes/:id" component={RecipeDetail} />
              <Route path="/recipes" component={Recipes} />
              <Route path="/vendors/:id" component={VendorDetail} />
              <Route path="/vendors" component={Vendors} />
              <Route path="/order-guides/:id/review" component={OrderGuideReview} />
              <Route path="/orders" component={Orders} />
              <Route path="/purchase-orders/:id" component={PurchaseOrderDetail} />
              <Route path="/purchase-orders" component={PurchaseOrders} />
              <Route path="/receiving/:poId" component={ReceivingDetail} />
              <Route path="/transfer-orders/:id" component={TransferOrderDetail} />
              <Route path="/transfer-orders" component={TransferOrders} />
              <Route path="/variance" component={VarianceReport} />
              <Route path="/waste" component={WasteEntry} />
              <Route path="/tfc/sales-import" component={TfcSalesImport} />
              <Route path="/tfc/variance" component={TfcVariance} />
              <Route path="/storage-locations" component={StorageLocations} />
              <Route path="/categories" component={Categories} />
              <Route path="/unit-conversions" component={UnitConversions} />
              <Route path="/api-credentials" component={ApiCredentials} />
              <Route path="/settings" component={Settings} />
              <Route component={NotFound} />
            </Switch>
          </main>
    </div>
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
              <Route path="/pending-approval" component={PendingApproval} />
              <Route path="/sso-access-denied" component={SsoAccessDenied} />
              <Route path="/accept-invitation/:token" component={AcceptInvitation} />
              <Route path="/onboarding" component={Onboarding} />
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
