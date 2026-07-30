import { useState, useEffect, useRef } from "react";
import { track } from "@/lib/analytics";
import { Link, useLocation } from "wouter";
import { Menu, X, ChevronRight, ChevronDown, LayoutDashboard, LogOut, User } from "lucide-react";
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

function getBasePath(location: string): string {
  const stripped = location.startsWith("/es") ? location.replace(/^\/es/, "") || "/" : location;
  return stripped;
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

    const setOgMeta = (property: string, content: string) => {
      let el = document.querySelector(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("description", description);

    setOgMeta("og:title", title);
    setOgMeta("og:description", description);
    setOgMeta("og:type", "website");
    setOgMeta("og:url", canonicalUrl);
    setOgMeta("og:site_name", "FnB Cost Pro");

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
  const active = location === href || location.startsWith(href + "/");
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

function NavDropdown({
  label,
  items,
  testId,
}: {
  label: string;
  items: { label: string; href: string }[];
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openMenu = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(true);
  };
  const closeMenu = () => {
    timerRef.current = setTimeout(() => setOpen(false), 80);
  };

  return (
    <div
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={closeMenu}
      data-testid={testId}
    >
      <button
        className={`flex items-center gap-0.5 text-sm font-medium transition-colors hover:text-green-600 ${open ? "text-green-600" : "text-gray-700"}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-0 pt-1 w-56 z-[60]"
          onMouseEnter={openMenu}
          onMouseLeave={closeMenu}
        >
          <div className="bg-white border border-gray-100 rounded-xl shadow-lg py-1.5">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-gray-700 hover:text-green-600 hover:bg-gray-50 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileExpandableSection({
  label,
  items,
  onItemClick,
}: {
  label: string;
  items: { label: string; href: string }[];
  onItemClick: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        className="flex items-center justify-between w-full text-sm font-medium text-gray-700 hover:text-green-600 py-0.5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="ml-3 mt-2 space-y-2.5 border-l-2 border-gray-100 pl-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onItemClick}
              className="block text-sm text-gray-600 hover:text-green-600 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
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
        onClick={() => lang !== "en" && track("language_switched", { language: lang, from: lang, to: "en" })}
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
        onClick={() => lang !== "es" && track("language_switched", { language: lang, from: lang, to: "es" })}
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

  const platformHref = lang === "es" ? "/es/platform" : "/platform";
  const forChefsHref = lang === "es" ? "/es/for-chefs" : "/for-chefs";
  const forFbLeadersHref = lang === "es" ? "/es/for-fb-leaders" : "/for-fb-leaders";
  const pricingHref = lang === "es" ? "/es/pricing" : "/pricing";
  const aboutHref = lang === "es" ? "/es/about" : "/about";
  const contactHref = lang === "es" ? "/es/contact" : "/contact";

  const platformDropdownItems = t.nav.platformItems.map((item) => ({
    label: item.label,
    href: `${platformHref}#${item.anchor}`,
  }));

  const industriesDropdownItems = t.nav.industriesItems.map((item) => ({
    label: item.label,
    href: lang === "es" ? `/es${item.href}` : item.href,
  }));

  const footerProductLinks = [
    { label: t.nav.platform, href: platformHref },
    { label: t.nav.forChefs, href: forChefsHref },
    { label: t.nav.forFbLeaders, href: forFbLeadersHref },
    { label: t.nav.pricing, href: pricingHref },
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

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-7">
              <NavDropdown
                label={t.nav.platform}
                items={platformDropdownItems}
                testId="nav-platform-dropdown"
              />
              <NavLink href={forChefsHref} label={t.nav.forChefs} />
              <NavLink href={forFbLeadersHref} label={t.nav.forFbLeaders} />
              <NavDropdown
                label={t.nav.industries}
                items={industriesDropdownItems}
                testId="nav-industries-dropdown"
              />
              <NavLink href={pricingHref} label={t.nav.pricing} />
              <NavLink href={aboutHref} label={t.nav.about} />
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
                  <Link href={contactHref}>
                    <Button
                      size="sm"
                      className="bg-orange-500 hover:bg-orange-600 text-white border-0"
                      data-testid="btn-nav-signup"
                    >
                      {t.nav.scheduleReview}
                    </Button>
                  </Link>
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

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-4">
            <MobileExpandableSection
              label={t.nav.platform}
              items={platformDropdownItems}
              onItemClick={() => setMobileOpen(false)}
            />
            <NavLink href={forChefsHref} label={t.nav.forChefs} onClick={() => setMobileOpen(false)} />
            <NavLink href={forFbLeadersHref} label={t.nav.forFbLeaders} onClick={() => setMobileOpen(false)} />
            <MobileExpandableSection
              label={t.nav.industries}
              items={industriesDropdownItems}
              onItemClick={() => setMobileOpen(false)}
            />
            <NavLink href={pricingHref} label={t.nav.pricing} onClick={() => setMobileOpen(false)} />
            <NavLink href={aboutHref} label={t.nav.about} onClick={() => setMobileOpen(false)} />
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
                  <Link href={contactHref} className="w-full">
                    <Button
                      className="w-full bg-orange-500 text-white border-0"
                      data-testid="btn-mobile-signup"
                    >
                      {t.nav.scheduleReview}
                    </Button>
                  </Link>
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
                {footerProductLinks.map((l) => (
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
                  <Link href={contactHref} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {t.nav.scheduleReview}
                  </Link>
                </li>
                <li>
                  <a href={appLink("/login")} className="text-sm text-gray-400 hover:text-white transition-colors">
                    {t.footer.login}
                  </a>
                </li>
                <li>
                  <Link
                    href={pricingHref}
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
                    href={aboutHref}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {t.footer.about}
                  </Link>
                </li>
                <li>
                  <Link
                    href={contactHref}
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

export function SectionHeading({ label, title, subtitle, align = "center" }: { label?: string; title: string; subtitle?: string; align?: "center" | "left" }) {
  const isCenter = align === "center";
  return (
    <div className={`mb-12 ${isCenter ? "text-center max-w-2xl mx-auto" : "text-left"}`}>
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
