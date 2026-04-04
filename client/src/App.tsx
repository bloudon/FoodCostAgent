import { Switch, Route, useLocation, Redirect } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { GlobalAdminHeader } from "@/components/global-admin-header";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import pkgJson from "../../package.json";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { StoreProvider } from "@/hooks/use-store-context";
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
import MenuImport from "@/pages/menu-import";
import Recipes from "@/pages/recipes";
import RecipeBuilder from "@/pages/recipe-builder";
import RecipeDetail from "@/pages/recipe-detail";
import UnitConversions from "@/pages/unit-conversions";
import Vendors from "@/pages/vendors";
import VendorDetail from "@/pages/vendor-detail";
import OrderGuideReview from "@/pages/order-guide-review";
import InventoryImport from "@/pages/inventory-import";
import RecipeImport from "@/pages/recipe-import";
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
import OnboardingWizard from "@/pages/onboarding-wizard";
import OnboardingMenuScan from "@/pages/onboarding-menu-scan";
import LeadSignup from "@/pages/lead-signup";
import ActivateAccount from "@/pages/activate-account";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import ChoosePlan from "@/pages/choose-plan";
import EnterpriseInquiry from "@/pages/enterprise-inquiry";
import EnterpriseOnboarding from "@/pages/enterprise-onboarding";
import AdminBackgrounds from "@/pages/admin-backgrounds";
import AdminUsers from "@/pages/admin-users";
import { ChatPanel } from "@/components/chat-panel";
import WebsiteHome from "@/pages/website/home";
import WebsiteFeatures from "@/pages/website/features";
import WebsitePricing from "@/pages/website/pricing";
import WebsiteAbout from "@/pages/website/about";
import WebsiteContact from "@/pages/website/contact";
import { LanguageContext } from "@/lib/language-context";
import { translations } from "@/lib/marketing-translations";
import type { Language } from "@/lib/marketing-translations";

const WEBSITE_DOMAINS = ["fnbcostpro.com", "www.fnbcostpro.com"];
if (new URLSearchParams(window.location.search).has("app")) {
  sessionStorage.setItem("forceAppMode", "1");
}
const isWebsiteMode =
  !sessionStorage.getItem("forceAppMode") &&
  (WEBSITE_DOMAINS.includes(window.location.hostname) ||
  import.meta.env.VITE_SHOW_WEBSITE === "true");

function withLang(lang: Language, Component: React.ComponentType) {
  return function LangWrapper() {
    return (
      <LanguageContext.Provider value={{ lang, t: translations[lang] }}>
        <Component />
      </LanguageContext.Provider>
    );
  };
}

const EnHome = withLang("en", WebsiteHome);
const EnFeatures = withLang("en", WebsiteFeatures);
const EnPricing = withLang("en", WebsitePricing);
const EnAbout = withLang("en", WebsiteAbout);
const EnContact = withLang("en", WebsiteContact);

const EsHome = withLang("es", WebsiteHome);
const EsFeatures = withLang("es", WebsiteFeatures);
const EsPricing = withLang("es", WebsitePricing);
const EsAbout = withLang("es", WebsiteAbout);
const EsContact = withLang("es", WebsiteContact);

function WebsiteRouter() {
  return (
    <Switch>
      <Route path="/" component={EnHome} />
      <Route path="/features" component={EnFeatures} />
      <Route path="/pricing" component={EnPricing} />
      <Route path="/about" component={EnAbout} />
      <Route path="/contact" component={EnContact} />
      <Route path="/es" component={EsHome} />
      <Route path="/es/features" component={EsFeatures} />
      <Route path="/es/pricing" component={EsPricing} />
      <Route path="/es/about" component={EsAbout} />
      <Route path="/es/contact" component={EsContact} />
      <Route path="/enterprise-inquiry" component={EnterpriseInquiry} />
      <Route path="/enterprise-onboarding" component={EnterpriseOnboarding} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={LeadSignup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/activate" component={ActivateAccount} />
      <Route path="/accept-invitation/:token" component={AcceptInvitation} />
      <Route component={EnHome} />
    </Switch>
  );
}

function ProtectedLayout() {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  const PUBLIC_PATHS = ["/login", "/signup", "/activate", "/onboarding", "/forgot-password", "/reset-password", "/choose-plan", "/accept-invitation", "/enterprise-inquiry", "/enterprise-onboarding"];

  useEffect(() => {
    if (!isLoading && !user && !PUBLIC_PATHS.some(p => location === p || location.startsWith(p + "/"))) {
      setLocation("/login");
    }
    
    if (!isLoading && user && user.role === "global_admin") {
      const selectedCompanyId = localStorage.getItem("selectedCompanyId");
      const isOnCompaniesPage = location === "/companies" || location.startsWith("/companies/");
      const isOnAdminPage = location.startsWith("/admin/") || location === "/admin";
      const isOnWizardPage = location === "/onboarding-wizard" || location === "/onboarding-review";
      if (!selectedCompanyId && !isOnCompaniesPage && !isOnAdminPage && !isOnWizardPage) {
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
  const { user } = useAuth();
  const [location] = useLocation();

  const isGlobalAdmin = user?.role === "global_admin";

  // These pages have their own full-screen layouts and must render without the nav shell,
  // even when reached by a logged-in user (e.g. direct URL navigation in production).
  const FULL_SCREEN_PATHS = [
    "/onboarding-wizard",
    "/onboarding-review",
    "/onboarding/menu-scan",
    "/onboarding",
    "/choose-plan",
    "/enterprise-inquiry",
    "/enterprise-onboarding",
    "/signup",
    "/activate",
    "/login",
    "/forgot-password",
    "/reset-password",
    "/accept-invitation",
  ];
  const isFullScreen = FULL_SCREEN_PATHS.some(
    (p) => location === p || location.startsWith(p + "/") || location.startsWith(p + "?")
  );

  if (isFullScreen) {
    return (
      <Switch>
        <Route path="/onboarding-wizard">
          {isGlobalAdmin ? <OnboardingWizard /> : <Redirect to="/" />}
        </Route>
        <Route path="/onboarding-review">
          {isGlobalAdmin ? <OnboardingWizard /> : <Redirect to="/" />}
        </Route>
        <Route path="/onboarding/menu-scan" component={OnboardingMenuScan} />
        <Route path="/onboarding"><Redirect to="/signup" /></Route>
        <Route path="/choose-plan" component={ChoosePlan} />
        <Route path="/enterprise-inquiry" component={EnterpriseInquiry} />
        <Route path="/enterprise-onboarding" component={EnterpriseOnboarding} />
        <Route path="/signup" component={LeadSignup} />
        <Route path="/activate" component={ActivateAccount} />
        <Route path="/login" component={Login} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/accept-invitation/:token" component={AcceptInvitation} />
      </Switch>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {isGlobalAdmin && <GlobalAdminHeader />}
      <SidebarProvider className="flex-1 min-h-0">
        <AppSidebar />
        <SidebarInset>
          {/* Top bar — SidebarTrigger always visible; logo shown on mobile only */}
          <div className="sticky top-0 z-50 flex h-12 items-center border-b px-4 bg-background gap-3">
            <SidebarTrigger data-testid="button-mobile-menu" />
            <img src="/website-logo.png" alt="FNB Cost Pro" className="h-7 w-auto md:hidden" />
          </div>

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
              <Route path="/menu-import" component={MenuImport} />
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
              <Route path="/inventory-import" component={InventoryImport} />
              <Route path="/recipe-import" component={RecipeImport} />
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
              <Route path="/admin/backgrounds" component={AdminBackgrounds} />
              <Route path="/admin/users" component={AdminUsers} />
              <Route component={NotFound} />
            </Switch>
          </main>

          <footer className="shrink-0 border-t px-4 py-1 text-center" data-testid="app-footer-version">
            <span className="text-[10px] text-muted-foreground">v{pkgJson.version}</span>
          </footer>
        </SidebarInset>
      </SidebarProvider>

      {/* ChatPanel is a fixed overlay — outside the sidebar shell */}
      <ChatPanel />
    </div>
  );
}

function App() {
  if (isWebsiteMode) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <AuthProvider>
              <WebsiteRouter />
            </AuthProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }
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
              <Route path="/onboarding/menu-scan" component={OnboardingMenuScan} />
              <Route path="/onboarding"><Redirect to="/signup" /></Route>
              <Route path="/signup" component={LeadSignup} />
              <Route path="/activate" component={ActivateAccount} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/choose-plan" component={ChoosePlan} />
              <Route path="/enterprise-inquiry" component={EnterpriseInquiry} />
              <Route path="/enterprise-onboarding" component={EnterpriseOnboarding} />
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
