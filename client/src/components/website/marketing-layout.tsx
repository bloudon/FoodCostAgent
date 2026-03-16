import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ChevronRight, LayoutDashboard, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function getAppUrl(): string {
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "fnbcostpro.com" || h === "www.fnbcostpro.com") {
      return "https://app.fnbcostpro.com";
    }
  }
  return import.meta.env.VITE_APP_URL || "";
}

const APP_URL = getAppUrl();

// In dev with VITE_SHOW_WEBSITE=true, the same origin serves both marketing
// and app. The app is gated behind ?app which sets forceAppMode in sessionStorage.
const DEV_WEBSITE_MODE =
  !APP_URL && import.meta.env.VITE_SHOW_WEBSITE === "true";

export function appLink(path: string) {
  if (DEV_WEBSITE_MODE) {
    // Append ?app so the SPA switches into app mode on arrival
    return path + (path.includes("?") ? "&app" : "?app");
  }
  return APP_URL + path;
}

const NAV_LINKS = [
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

function NavLink({ href, label, onClick }: { href: string; label: string; onClick?: () => void }) {
  const [location] = useLocation();
  const active = location === href;
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`text-sm font-medium transition-colors hover:text-green-600 ${
        active ? "text-green-600" : "text-gray-700"
      }`}
    >
      {label}
    </Link>
  );
}

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: authUser } = useQuery<{ id: string; email: string; firstName?: string; lastName?: string } | null>({
    queryKey: ["/api/auth/me"],
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    },
    onSuccess: () => {
      window.location.reload();
    },
  });

  const isLoggedIn = !!authUser?.id;
  const displayName = authUser?.firstName
    ? `${authUser.firstName}${authUser.lastName ? " " + authUser.lastName : ""}`
    : authUser?.email ?? "";

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <Link href="/" className="flex-shrink-0">
              <img src="/website-logo.png" alt="FnB Cost Pro" className="h-16 w-auto -my-3" />
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              {NAV_LINKS.map((l) => (
                <NavLink key={l.href} href={l.href} label={l.label} />
              ))}
            </nav>

            <div className="hidden md:flex items-center gap-3">
              {isLoggedIn ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white border-0"
                      data-testid="btn-nav-my-account"
                    >
                      <User className="h-4 w-4 mr-1.5" />
                      My Account
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="font-normal">
                      <p className="text-sm font-medium leading-none">{displayName}</p>
                      {authUser?.firstName && (
                        <p className="text-xs text-muted-foreground mt-1">{authUser.email}</p>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a href={appLink("/")} className="flex items-center gap-2 cursor-pointer" data-testid="btn-nav-dashboard">
                        <LayoutDashboard className="h-4 w-4" />
                        Go to Dashboard
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="flex items-center gap-2 text-red-600 focus:text-red-600 cursor-pointer"
                      onClick={() => logoutMutation.mutate()}
                      disabled={logoutMutation.isPending}
                      data-testid="btn-nav-logout"
                    >
                      <LogOut className="h-4 w-4" />
                      {logoutMutation.isPending ? "Signing out…" : "Sign out"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <a href={appLink("/login")}>
                    <Button variant="ghost" size="sm" data-testid="btn-nav-login">
                      Log in
                    </Button>
                  </a>
                  <a href={appLink("/signup")}>
                    <Button
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white border-0"
                      data-testid="btn-nav-signup"
                    >
                      Get Started Free
                    </Button>
                  </a>
                </>
              )}
            </div>

            <button
              className="md:hidden p-2 rounded-md text-gray-600 hover:text-gray-900"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              data-testid="btn-mobile-menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-4">
            {NAV_LINKS.map((l) => (
              <NavLink key={l.href} href={l.href} label={l.label} onClick={() => setMobileOpen(false)} />
            ))}
            <div className="pt-2 flex flex-col gap-2">
              {isLoggedIn ? (
                <>
                  <div className="px-1 pb-1">
                    <p className="text-sm font-medium text-gray-900">{displayName}</p>
                    {authUser?.firstName && (
                      <p className="text-xs text-gray-500">{authUser.email}</p>
                    )}
                  </div>
                  <a href={appLink("/")} className="w-full">
                    <Button variant="outline" className="w-full gap-2" data-testid="btn-mobile-dashboard">
                      <LayoutDashboard className="h-4 w-4" />
                      Go to Dashboard
                    </Button>
                  </a>
                  <Button
                    variant="ghost"
                    className="w-full gap-2 text-red-600 hover:text-red-600"
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                    data-testid="btn-mobile-logout"
                  >
                    <LogOut className="h-4 w-4" />
                    {logoutMutation.isPending ? "Signing out…" : "Sign out"}
                  </Button>
                </>
              ) : (
                <>
                  <a href={appLink("/login")} className="w-full">
                    <Button variant="outline" className="w-full" data-testid="btn-mobile-login">
                      Log in
                    </Button>
                  </a>
                  <a href={appLink("/signup")} className="w-full">
                    <Button
                      className="w-full bg-orange-500 text-white border-0"
                      data-testid="btn-mobile-signup"
                    >
                      Get Started Free
                    </Button>
                  </a>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-gray-900 text-gray-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="md:col-span-1">
              <img src="/website-logo-dark.png" alt="FnB Cost Pro" className="h-16 w-auto -mt-3" />
              <p className="text-sm text-gray-400 leading-relaxed">
                F&B inventory management and recipe costing for restaurants and Food & Beverage businesses.
              </p>
            </div>

            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Product</h4>
              <ul className="space-y-2">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-gray-400 hover:text-white transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Get Started</h4>
              <ul className="space-y-2">
                <li>
                  <a href={appLink("/signup")} className="text-sm text-gray-400 hover:text-white transition-colors">
                    Get Started Free
                  </a>
                </li>
                <li>
                  <a href={appLink("/login")} className="text-sm text-gray-400 hover:text-white transition-colors">
                    Log in
                  </a>
                </li>
                <li>
                  <Link href="/pricing" className="text-sm text-gray-400 hover:text-white transition-colors">
                    View Pricing
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Company</h4>
              <ul className="space-y-2">
                <li>
                  <Link href="/about" className="text-sm text-gray-400 hover:text-white transition-colors">
                    About
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="text-sm text-gray-400 hover:text-white transition-colors">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-gray-800 flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-gray-500">&copy; {new Date().getFullYear()} FnB Cost Pro. All rights reserved.</p>
            <div className="flex gap-4">
              <span className="text-xs text-gray-500">Privacy Policy</span>
              <span className="text-xs text-gray-500">Terms of Service</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function SectionHeading({ label, title, subtitle }: { label?: string; title: string; subtitle?: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto mb-12">
      {label && (
        <span className="inline-block text-xs font-semibold uppercase tracking-widest text-green-600 mb-3">
          {label}
        </span>
      )}
      <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">{title}</h2>
      {subtitle && <p className="text-lg text-gray-500 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

export function CTAButton({ href, children, large }: { href: string; children: React.ReactNode; large?: boolean }) {
  return (
    <a href={href}>
      <Button
        size={large ? "lg" : "default"}
        className={`bg-orange-500 text-white border-0 gap-1 ${large ? "text-base px-8 py-6" : ""}`}
        data-testid="btn-cta"
      >
        {children}
        <ChevronRight className={large ? "h-5 w-5" : "h-4 w-4"} />
      </Button>
    </a>
  );
}
