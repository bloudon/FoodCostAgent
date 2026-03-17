import { useState, useEffect } from "react";
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
import { useLanguage } from "@/lib/language-context";
import type { Language } from "@/lib/marketing-translations";

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

const DEV_WEBSITE_MODE =
  !APP_URL && import.meta.env.VITE_SHOW_WEBSITE === "true";

export function appLink(path: string) {
  if (DEV_WEBSITE_MODE) {
    return path + (path.includes("?") ? "&app" : "?app");
  }
  return APP_URL + path;
}

const BASE_DOMAIN = "https://fnbcostpro.com";

const PAGE_PATHS: Record<string, string> = {
  "/": "/",
  "/features": "/features",
  "/pricing": "/pricing",
  "/about": "/about",
  "/contact": "/contact",
};

function getBasePath(location: string): string {
  const stripped = location.startsWith("/es") ? location.replace(/^\/es/, "") || "/" : location;
  return PAGE_PATHS[stripped] ?? stripped;
}

export function MarketingHead({
  title,
  description,
  lang,
}: {
  title: string;
  description: string;
  lang: Language;
}) {
  const [location] = useLocation();
  const basePath = getBasePath(location);
  const enUrl = `${BASE_DOMAIN}${basePath}`;
  const esUrl = `${BASE_DOMAIN}/es${basePath === "/" ? "" : basePath}`;
  const canonicalUrl = lang === "es" ? esUrl : enUrl;

  useEffect(() => {
    document.title = title;

    const setMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("description", description);

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link") as HTMLLinkElement;
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", canonicalUrl);

    const updateHreflang = (hreflang: string, href: string) => {
      let el = document.querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`) as HTMLLinkElement | null;
      if (!el) {
        el = document.createElement("link") as HTMLLinkElement;
        el.setAttribute("rel", "alternate");
        el.setAttribute("hreflang", hreflang);
        document.head.appendChild(el);
      }
      el.setAttribute("href", href);
    };

    updateHreflang("en", enUrl);
    updateHreflang("es", esUrl);
    updateHreflang("x-default", enUrl);
  }, [title, description, canonicalUrl, enUrl, esUrl]);

  return null;
}

function NavLink({
  href,
  label,
  onClick,
}: {
  href: string;
  label: string;
  onClick?: () => void;
}) {
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

function LanguageToggle({ lang }: { lang: Language }) {
  const [location] = useLocation();

  function getTogglePath(targetLang: Language): string {
    if (targetLang === "es") {
      if (location === "/" || location === "") return "/es";
      if (location.startsWith("/es")) return location;
      return "/es" + location;
    } else {
      if (location.startsWith("/es/")) return location.replace(/^\/es/, "");
      if (location === "/es") return "/";
      return location;
    }
  }

  const enPath = getTogglePath("en");
  const esPath = getTogglePath("es");

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-gray-200 overflow-hidden" data-testid="language-toggle">
      <Link
        href={enPath}
        data-testid="lang-toggle-en"
        className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
          lang === "en"
            ? "bg-green-600 text-white"
            : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        }`}
      >
        EN
      </Link>
      <Link
        href={esPath}
        data-testid="lang-toggle-es"
        className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
          lang === "es"
            ? "bg-green-600 text-white"
            : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        }`}
      >
        ES
      </Link>
    </div>
  );
}

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { lang, t } = useLanguage();

  const navLinks = [
    { label: t.nav.features, href: lang === "es" ? "/es/features" : "/features" },
    { label: t.nav.pricing, href: lang === "es" ? "/es/pricing" : "/pricing" },
    { label: t.nav.about, href: lang === "es" ? "/es/about" : "/about" },
    { label: t.nav.contact, href: lang === "es" ? "/es/contact" : "/contact" },
  ];

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

  const homeHref = lang === "es" ? "/es" : "/";

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <Link href={homeHref} className="flex-shrink-0">
              <img src="/website-logo.png" alt="FnB Cost Pro" className="h-16 w-auto -my-3" />
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              {navLinks.map((l) => (
                <NavLink key={l.href} href={l.href} label={l.label} />
              ))}
            </nav>

            <div className="hidden md:flex items-center gap-3">
              <LanguageToggle lang={lang} />
              {isLoggedIn ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white border-0"
                      data-testid="btn-nav-my-account"
                    >
                      <User className="h-4 w-4 mr-1.5" />
                      {t.nav.myAccount}
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
                        {t.nav.goToDashboard}
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
                      {logoutMutation.isPending ? t.nav.signingOut : t.nav.signOut}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <a href={appLink("/login")}>
                    <Button variant="ghost" size="sm" data-testid="btn-nav-login">
                      {t.nav.login}
                    </Button>
                  </a>
                  <a href={appLink("/signup")}>
                    <Button
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white border-0"
                      data-testid="btn-nav-signup"
                    >
                      {t.nav.getStarted}
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
            {navLinks.map((l) => (
              <NavLink key={l.href} href={l.href} label={l.label} onClick={() => setMobileOpen(false)} />
            ))}
            <div className="pt-1">
              <LanguageToggle lang={lang} />
            </div>
            <div className="pt-1 flex flex-col gap-2">
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
                      {t.nav.goToDashboard}
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
                    {logoutMutation.isPending ? t.nav.signingOut : t.nav.signOut}
                  </Button>
                </>
              ) : (
                <>
                  <a href={appLink("/login")} className="w-full">
                    <Button variant="outline" className="w-full" data-testid="btn-mobile-login">
                      {t.nav.login}
                    </Button>
                  </a>
                  <a href={appLink("/signup")} className="w-full">
                    <Button
                      className="w-full bg-orange-500 text-white border-0"
                      data-testid="btn-mobile-signup"
                    >
                      {t.nav.getStarted}
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
                {t.footer.tagline}
              </p>
            </div>

            <div>
              <h4 className="text-white font-semibold text-sm mb-3">{t.footer.product}</h4>
              <ul className="space-y-2">
                {navLinks.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-gray-400 hover:text-white transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold text-sm mb-3">{t.footer.getStarted}</h4>
              <ul className="space-y-2">
                <li>
                  <a href={appLink("/signup")} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {t.footer.getStartedFree}
                  </a>
                </li>
                <li>
                  <a href={appLink("/login")} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {t.footer.login}
                  </a>
                </li>
                <li>
                  <Link
                    href={lang === "es" ? "/es/pricing" : "/pricing"}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {t.footer.viewPricing}
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold text-sm mb-3">{t.footer.company}</h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    href={lang === "es" ? "/es/about" : "/about"}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {t.footer.about}
                  </Link>
                </li>
                <li>
                  <Link
                    href={lang === "es" ? "/es/contact" : "/contact"}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {t.footer.contact}
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-gray-800 flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-gray-500">&copy; {new Date().getFullYear()} FnB Cost Pro. {t.footer.rights}</p>
            <div className="flex gap-4">
              <span className="text-xs text-gray-500">{t.footer.privacy}</span>
              <span className="text-xs text-gray-500">{t.footer.terms}</span>
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
