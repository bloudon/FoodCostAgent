import { Switch, Route, useLocation, Redirect } from "wouter";
import { useEffect, useState, useCallback } from "react";
import { LogOut, ChevronLeft, ChevronRight, RotateCcw, Search, Store } from "lucide-react";
import { NavHistoryProvider, useNavHistory } from "@/lib/nav-history-context";
import { getLabelForPath } from "@/lib/route-config";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { useAppLanguage } from "@/lib/language-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { GlobalAdminHeader } from "@/components/global-admin-header";
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import pkgJson from "../../package.json";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { StoreProvider, useStoreContext } from "@/hooks/use-store-context";
import { useCompany } from "@/hooks/use-company";
import { useEmbedded } from "@/hooks/use-embedded";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import InventorySessions from "@/pages/inventory-sessions";
import InventoryCount from "@/pages/inventory-count";
import CountSession from "@/pages/count-session";
import CountSessionMobile from "@/pages/count-session-mobile";
import NewCountSession from "@/pages/new-count-session";
import ItemCount from "@/pages/item-count";
import InventoryItems from "@/pages/inventory-items";
import ParLevels from "@/pages/par-levels";
import InventoryItemDetail from "@/pages/inventory-item-detail";
import InventoryItemCreate from "@/pages/inventory-item-create";
import MenuItems from "@/pages/menu-items";
import MenuImport from "@/pages/menu-import";
import MenusPage from "@/pages/menus";
import MenuBuilderPage from "@/pages/menu-builder";
import MenuScanTool from "@/pages/menu-scan-tool";
import Recipes from "@/pages/recipes";
import RecipeBuilder from "@/pages/recipe-builder";
import RecipeDetail from "@/pages/recipe-detail";
import UnitConversions from "@/pages/unit-conversions";
import Vendors from "@/pages/vendors";
import VendorDetail from "@/pages/vendor-detail";
import OrderGuideReview from "@/pages/order-guide-review";
import OrderGuideScan from "@/pages/order-guide-scan";
import InventoryImport from "@/pages/inventory-import";
import OrderlyImport from "@/pages/orderly-import";
import OrderlyReport from "@/pages/orderly-report";
import SalesByItemImport from "@/pages/sales-by-item-import";
import PosRecipeLinking from "@/pages/pos-recipe-linking";
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
import PosLocationMapping from "@/pages/pos-location-mapping";
import PosItemMapping from "@/pages/pos-item-mapping";
import TfcVariance from "@/pages/tfc-variance";
import Login from "@/pages/login";
import PendingApproval from "@/pages/pending-approval";
import SsoAccessDenied from "@/pages/sso-access-denied";
import AcceptInvitation from "@/pages/accept-invitation";
import OnboardingWizard from "@/pages/onboarding-wizard";
import OnboardingSetup from "@/pages/onboarding-setup";
import LeadSignup from "@/pages/lead-signup";
import ActivateAccount from "@/pages/activate-account";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import ChoosePlan from "@/pages/choose-plan";
import EnterpriseInquiry from "@/pages/enterprise-inquiry";
import EnterpriseOnboarding from "@/pages/enterprise-onboarding";
import AdminBackgrounds from "@/pages/admin-backgrounds";
import AdminVendorRegistry from "@/pages/admin-vendor-registry";
import AdminPosSyncJobs from "@/pages/admin-pos-sync-jobs";
import MenuInsights from "@/pages/menu-insights";
import ExtensionPilot from "@/pages/extension-pilot";
import ReportsHub from "@/pages/reports/ReportsHub";
import ReportViewer from "@/pages/reports/ReportViewer";
import ScheduledReportsPage from "@/pages/reports/ScheduledReportsPage";
import AdminUsers from "@/pages/admin-users";
import CountLanding from "@/pages/count-landing";
import OrderLanding from "@/pages/order-landing";
import PrepLanding from "@/pages/prep-landing";
import AnalyzeLanding from "@/pages/analyze-landing";
import MoreLanding from "@/pages/more-landing";
import PrepChart from "@/pages/prep-chart";
import PrepChartItems from "@/pages/prep-chart-items";
import PrepItemBuilder from "@/pages/prep-item-builder";
import PrepChartStations from "@/pages/prep-chart-stations";
import PrepChartOnHand from "@/pages/prep-chart-on-hand";
import PrepChartProduction from "@/pages/prep-chart-production";
import ShelfScans from "@/pages/shelf-scans";
import DashboardMobile from "@/pages/dashboard-mobile";
import { ChatPanel } from "@/components/chat-panel";
import { GlobalSearch } from "@/components/global-search";
import { WhatsNewModal } from "@/components/whats-new-modal";
import { VersionBanner } from "@/components/version-banner";
import { PosDisconnectedBanner } from "@/components/pos-disconnected-banner";
import WebsiteHome from "@/pages/website/home";
import WebsiteFeatures from "@/pages/website/features";
import WebsitePricing from "@/pages/website/pricing";
import WebsiteAbout from "@/pages/website/about";
import WebsiteContact from "@/pages/website/contact";
import WebsitePlatform from "@/pages/website/platform";
import WebsiteForChefs from "@/pages/website/for-chefs";
import WebsiteForFbLeaders from "@/pages/website/for-fb-leaders";
import WebsiteIndustryChefLed from "@/pages/website/industry-chef-led";
import WebsiteIndustryGroups from "@/pages/website/industry-groups";
import WebsiteIndustryClubs from "@/pages/website/industry-clubs";
import { LanguageContext } from "@/lib/language-context";
import { translations } from "@/lib/marketing-translations";
import type { Language } from "@/lib/marketing-translations";
import { UndoProvider } from "@/contexts/undo-context";
import { AppLanguageProvider } from "@/lib/language-context";
import { useGa4 } from "@/hooks/use-ga4";
import InventoryItemsDedup from "@/pages/inventory-items-dedup";

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

const EnPlatform = withLang("en", WebsitePlatform);
const EnForChefs = withLang("en", WebsiteForChefs);
const EnForFbLeaders = withLang("en", WebsiteForFbLeaders);
const EnIndustryChefLed = withLang("en", WebsiteIndustryChefLed);
const EnIndustryGroups = withLang("en", WebsiteIndustryGroups);
const EnIndustryClubs = withLang("en", WebsiteIndustryClubs);

const EsPlatform = withLang("es", WebsitePlatform);
const EsForChefs = withLang("es", WebsiteForChefs);
const EsForFbLeaders = withLang("es", WebsiteForFbLeaders);
const EsIndustryChefLed = withLang("es", WebsiteIndustryChefLed);
const EsIndustryGroups = withLang("es", WebsiteIndustryGroups);
const EsIndustryClubs = withLang("es", WebsiteIndustryClubs);

function WebsiteRouter() {
  useGa4();
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
      <Route path="/platform" component={EnPlatform} />
      <Route path="/for-chefs" component={EnForChefs} />
      <Route path="/for-fb-leaders" component={EnForFbLeaders} />
      <Route path="/industries/chef-led-restaurants" component={EnIndustryChefLed} />
      <Route path="/industries/restaurant-groups" component={EnIndustryGroups} />
      <Route path="/industries/clubs-resorts" component={EnIndustryClubs} />
      <Route path="/es/platform" component={EsPlatform} />
      <Route path="/es/for-chefs" component={EsForChefs} />
      <Route path="/es/for-fb-leaders" component={EsForFbLeaders} />
      <Route path="/es/industries/chef-led-restaurants" component={EsIndustryChefLed} />
      <Route path="/es/industries/restaurant-groups" component={EsIndustryGroups} />
      <Route path="/es/industries/clubs-resorts" component={EsIndustryClubs} />
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
      const isOnWizardPage = location === "/onboarding-wizard";
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
      <UndoProvider>
        <ProtectedLayoutContent />
      </UndoProvider>
    </StoreProvider>
  );
}

/** Renders the top bar inside SidebarInset so useSidebar() is in scope. */
function AppTopBar({ onSearchOpen }: { onSearchOpen?: () => void }) {
  const { isMobile } = useSidebar();
  const { user, logout } = useAuth();
  const { t } = useAppLanguage();
  const companyName = user?.companyName;
  const { canGoBack, canGoForward, goBack, goForward, refresh } = useNavHistory();
  const [location] = useLocation();
  const pageLabel = getLabelForPath(location);
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  const userInitials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
      : user?.email?.[0]?.toUpperCase() ?? "U";

  const userName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email ?? "User";

  const { selectedStoreId, setSelectedStoreId, stores } = useStoreContext();
  const { company } = useCompany();

  const navBtnClass =
    "inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover-elevate active-elevate-2 transition-colors disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div className="sticky top-0 z-50 grid grid-cols-[1fr_auto_1fr] h-12 items-center border-b px-4 bg-accent gap-2">
      {/* ── Left: hamburger, logo, nav controls, page label ── */}
      <div className="flex items-center gap-1 min-w-0">
        {isMobile && (
          <SidebarTrigger data-testid="button-mobile-menu" />
        )}
        <img src="/website-logo.png" alt="FNB Cost Pro" className="h-7 w-auto md:hidden mr-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={goBack}
              disabled={!canGoBack}
              aria-label="Back"
              data-testid="button-nav-back"
              className={navBtnClass}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={goForward}
              disabled={!canGoForward}
              aria-label="Forward"
              data-testid="button-nav-forward"
              className={navBtnClass}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Forward</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={refresh}
              aria-label="Refresh"
              data-testid="button-nav-refresh"
              className={navBtnClass}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>

        {pageLabel && (
          <span
            className="hidden md:block text-sm font-medium text-foreground ml-1 truncate"
            data-testid="text-topbar-page-label"
          >
            {pageLabel}
          </span>
        )}
      </div>

      {/* ── Center: global search box ── */}
      {onSearchOpen ? (
        <button
          onClick={onSearchOpen}
          aria-label="Search"
          data-testid="button-global-search"
          className="flex items-center gap-2 h-8 w-48 sm:w-56 md:w-72 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-accent hover:border-ring transition-colors"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left text-sm">Search…</span>
          <kbd className="hidden md:inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border border-border/60">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
      ) : (
        <div />
      )}

      {/* ── Right: store picker, company name, theme, language, avatar, logout ── */}
      <div className="flex items-center justify-end gap-1">
        {company && stores.length > 0 && (
          <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
            <SelectTrigger
              className="h-8 w-36 text-xs"
              data-testid={isMobile ? "select-store-mobile" : "select-store"}
            >
              <Store className="h-3.5 w-3.5 mr-1 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              {stores.map((store) => (
                <SelectItem
                  key={store.id}
                  value={store.id}
                  data-testid={`select-store-${store.id}`}
                >
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {companyName && (
          <span
            className="hidden lg:block text-sm font-medium text-muted-foreground max-w-[160px] truncate mr-1"
            data-testid="text-topbar-company-name"
          >
            {companyName}
          </span>
        )}

        <ThemeToggle />
        <LanguageToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold cursor-default select-none"
              aria-label={userName}
            >
              {userInitials}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-semibold">{userName}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={logout}
              data-testid={isMobile ? "button-logout-mobile" : "button-logout"}
              className={navBtnClass}
              aria-label={t.auth.logout}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.auth.logout}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function ProtectedLayoutContent() {
  const { user, refreshAuth } = useAuth();
  const [location] = useLocation();
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const isEmbedded = useEmbedded();

  const openSearch = useCallback(() => setSearchOpen(true), []);

  // Global ⌘K / Ctrl+K shortcut — guarded against inputs, modals, contenteditable
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "k") return;
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (inInput) return;
      // Don't open if another dialog/modal is already open
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const isGlobalAdmin = user?.role === "global_admin";

  // These pages have their own full-screen layouts and must render without the nav shell,
  // even when reached by a logged-in user (e.g. direct URL navigation in production).
  const FULL_SCREEN_PATHS = [
    "/onboarding-wizard",
    "/onboarding/setup",
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
        <Route path="/onboarding/setup" component={OnboardingSetup} />
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

  if (isEmbedded) {
    return (
      <main className="h-screen overflow-auto">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard/mobile" component={DashboardMobile} />
          <Route path="/inventory-sessions" component={InventorySessions} />
          <Route path="/new-count" component={NewCountSession} />
          <Route path="/inventory-count" component={InventoryCount} />
          <Route path="/count/:id/mobile" component={CountSessionMobile} />
          <Route path="/count/:id" component={CountSession} />
          <Route path="/item-count/:id" component={ItemCount} />
          <Route path="/purchase-orders/:id" component={PurchaseOrderDetail} />
          {/* Quick Access tiles — mobile dashboard shortcuts */}
          <Route path="/inventory-items" component={InventoryItems} />
          <Route path="/inventory-items/:id" component={InventoryItemDetail} />
          <Route path="/recipes" component={Recipes} />
          <Route path="/shelf-scans" component={ShelfScans} />
          <Route path="/tfc/variance" component={TfcVariance} />
          <Route path="/stores" component={Stores} />
          <Route path="/waste" component={WasteEntry} />
          <Route component={NotFound} />
        </Switch>
      </main>
    );
  }

  return (
    <NavHistoryProvider>
    <div className="flex flex-col h-screen">
      {isGlobalAdmin && <GlobalAdminHeader />}
      <SidebarProvider
        className="flex-1 min-h-0"
        defaultOpen={false}
        style={{
          "--sidebar-width": "230px",
          "--sidebar-width-icon": "80px",
        } as React.CSSProperties}
      >
        <AppSidebar />
        <SidebarInset>
          <AppTopBar onSearchOpen={openSearch} />

          <VersionBanner
            currentVersion={pkgJson.version}
            userLastSeenVersion={user?.lastSeenVersion}
            onAcknowledged={refreshAuth}
          />

          <PosDisconnectedBanner />

          <main className="flex-1 overflow-auto">
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/companies/:id" component={CompanyDetail} />
              <Route path="/companies" component={Companies} />
              <Route path="/stores" component={Stores} />
              <Route path="/users" component={Users} />
              <Route path="/inventory-items" component={InventoryItems} />
              <Route path="/inventory-items/duplicates" component={InventoryItemsDedup} />
              <Route path="/inventory-items/par-levels" component={ParLevels} />
              <Route path="/inventory-items/new" component={InventoryItemCreate} />
              <Route path="/inventory-items/:id" component={InventoryItemDetail} />
              <Route path="/menu-items/:id" component={MenuItems} />
              <Route path="/menu-items" component={MenuItems} />
              <Route path="/menus/:id" component={MenuBuilderPage} />
              <Route path="/menus" component={MenusPage} />
              <Route path="/menu-scan" component={MenuScanTool} />
              <Route path="/menu-import"><Redirect to="/menu-scan" /></Route>
              <Route path="/inventory-sessions" component={InventorySessions} />
              <Route path="/new-count" component={NewCountSession} />
              <Route path="/inventory-count"><Redirect to="/count" /></Route>
              <Route path="/count" component={CountLanding} />
              <Route path="/count/:id/mobile" component={CountSessionMobile} />
              <Route path="/count/:id" component={CountSession} />
              <Route path="/item-count/:id" component={ItemCount} />
              <Route path="/recipes/new" component={RecipeBuilder} />
              <Route path="/recipes/:id/edit" component={RecipeBuilder} />
              <Route path="/recipes/:id" component={RecipeDetail} />
              <Route path="/recipes" component={Recipes} />
              <Route path="/vendors/:id" component={VendorDetail} />
              <Route path="/vendors" component={Vendors} />
              <Route path="/order-guide-scan" component={OrderGuideScan} />
              <Route path="/order-guides/:id/review" component={OrderGuideReview} />
              <Route path="/inventory-import" component={InventoryImport} />
              <Route path="/orderly-import" component={OrderlyImport} />
              <Route path="/orderly-report" component={OrderlyReport} />
              <Route path="/sales-by-item-import" component={SalesByItemImport} />
              <Route path="/pos-recipe-linking" component={PosRecipeLinking} />
              <Route path="/recipe-import" component={RecipeImport} />
              <Route path="/order" component={OrderLanding} />
              <Route path="/orders" component={Orders} />
              <Route path="/purchase-orders/:id" component={PurchaseOrderDetail} />
              <Route path="/purchase-orders"><Redirect to="/orders" /></Route>
              <Route path="/receiving/:poId" component={ReceivingDetail} />
              <Route path="/transfer-orders/:id" component={TransferOrderDetail} />
              <Route path="/transfer-orders" component={TransferOrders} />
              <Route path="/variance" component={VarianceReport} />
              <Route path="/waste" component={WasteEntry} />
              <Route path="/pos/location-mapping/:connectionId" component={PosLocationMapping} />
              <Route path="/pos/item-mapping/:connectionId" component={PosItemMapping} />
              <Route path="/tfc/sales-import" component={TfcSalesImport} />
              <Route path="/tfc/variance" component={TfcVariance} />
              <Route path="/storage-locations" component={StorageLocations} />
              <Route path="/categories" component={Categories} />
              <Route path="/unit-conversions" component={UnitConversions} />
              <Route path="/api-credentials" component={ApiCredentials} />
              <Route path="/settings" component={Settings} />
              <Route path="/admin/backgrounds" component={AdminBackgrounds} />
              <Route path="/admin/users" component={AdminUsers} />
              <Route path="/admin/vendor-registry" component={AdminVendorRegistry} />
              <Route path="/admin/pos-sync-jobs" component={AdminPosSyncJobs} />
              <Route path="/prep" component={PrepLanding} />
              <Route path="/analyze" component={AnalyzeLanding} />
              <Route path="/more" component={MoreLanding} />
              <Route path="/prep-chart" component={PrepChart} />
              <Route path="/prep-chart/items/new" component={PrepItemBuilder} />
              <Route path="/prep-chart/items/:id" component={PrepItemBuilder} />
              <Route path="/prep-chart/items" component={PrepChartItems} />
              <Route path="/prep-chart/stations" component={PrepChartStations} />
              <Route path="/prep-chart/on-hand" component={PrepChartOnHand} />
              <Route path="/prep-chart/production" component={PrepChartProduction} />
              <Route path="/shelf-scans" component={ShelfScans} />
              <Route path="/dashboard/mobile" component={DashboardMobile} />
              <Route path="/menu-insights" component={MenuInsights} />
              <Route path="/reports/scheduled" component={ScheduledReportsPage} />
              <Route path="/reports/view" component={ReportViewer} />
              <Route path="/reports" component={ReportsHub} />
              {import.meta.env.DEV && (
                <Route path="/extension-pilot" component={ExtensionPilot} />
              )}
              <Route component={NotFound} />
            </Switch>
          </main>

          <footer className="shrink-0 border-t px-4 py-1 text-center" data-testid="app-footer-version">
            <button
              type="button"
              onClick={() => setWhatsNewOpen(true)}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
              data-testid="button-footer-version"
            >
              v{pkgJson.version}
            </button>
          </footer>

          <WhatsNewModal
            open={whatsNewOpen}
            onOpenChange={setWhatsNewOpen}
            currentVersion={pkgJson.version}
            userLastSeenVersion={user?.lastSeenVersion}
            onAcknowledged={refreshAuth}
          />
        </SidebarInset>
      </SidebarProvider>

      {/* ChatPanel is a fixed overlay — outside the sidebar shell */}
      <ChatPanel />

      {/* Global search dialog */}
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
    </NavHistoryProvider>
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
            <AppLanguageProvider>
              <Switch>
                <Route path="/login" component={Login} />
                <Route path="/pending-approval" component={PendingApproval} />
                <Route path="/sso-access-denied" component={SsoAccessDenied} />
                <Route path="/accept-invitation/:token" component={AcceptInvitation} />
                <Route path="/onboarding/setup" component={OnboardingSetup} />
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
            </AppLanguageProvider>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
