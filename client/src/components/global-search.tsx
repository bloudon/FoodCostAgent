/**
 * GlobalSearch — Ctrl+K command palette for page navigation.
 *
 * Default mode: client-side filtered list of all permitted app pages derived
 * from ROUTE_CONFIG. No API call for regular users; results are instant.
 *
 * Global Admin escape hatch: when a global_admin has typed ≥2 characters, a
 * "Search all data" item appears at the bottom. Selecting it calls /api/search
 * and shows entity records (inventory items, recipes, vendors, etc.) inline.
 *
 * Permission filtering:
 *   - Routes with `requiredRole` are hidden when the user's role is below it.
 *   - Routes with `requiredFeature` are hidden when the company's tier doesn't
 *     include that feature.
 *   - Dynamic routes with `:param` segments are excluded (no ID to navigate to).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Home,
  Package,
  ShoppingCart,
  Flame,
  BarChart2,
  Settings2,
  ChefHat,
  Utensils,
  Truck,
  Tag,
  BookOpen,
  MapPin,
  FileText,
  Loader2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Database,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTier } from "@/hooks/use-tier";
import { ROUTE_CONFIG, type NavSection } from "@/lib/route-config";
import { track } from "@/lib/analytics";

// ── Entity search types (used for Global Admin escape hatch only) ──────────

export type SearchEntityType =
  | "inventory_item"
  | "recipe"
  | "menu_item"
  | "vendor"
  | "vendor_item"
  | "purchase_order"
  | "prep_item"
  | "menu"
  | "storage_location"
  | "order_guide";

export interface GlobalSearchResult {
  type: SearchEntityType;
  id: string;
  name: string;
  subtitle?: string;
  route: string;
  status?: string;
  iconKey: string;
  matchedField: string;
}

// ── Permission helpers ─────────────────────────────────────────────────────

const ROLE_RANK: Record<string, number> = {
  store_manager: 1,
  company_admin: 2,
  global_admin: 3,
};

function userMeetsRole(
  userRole: string | undefined | null,
  requiredRole: string | undefined,
): boolean {
  if (!requiredRole) return true;
  if (!userRole) return false;
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[requiredRole] ?? 0);
}

// ── Nav section constants ──────────────────────────────────────────────────

const SECTION_LABELS: Record<NavSection, string> = {
  home: "Home",
  count: "Inventory",
  order: "Order",
  prep: "Prep",
  analyze: "Analyze",
  more: "More",
};

const SECTION_ORDER: NavSection[] = ["home", "count", "order", "prep", "analyze", "more"];

function SectionIcon({ section, className }: { section: NavSection; className?: string }) {
  const props = { className: className ?? "h-4 w-4 shrink-0 text-muted-foreground" };
  switch (section) {
    case "home":    return <Home {...props} />;
    case "count":   return <Package {...props} />;
    case "order":   return <ShoppingCart {...props} />;
    case "prep":    return <Flame {...props} />;
    case "analyze": return <BarChart2 {...props} />;
    case "more":    return <Settings2 {...props} />;
  }
}

// ── Entity search constants ────────────────────────────────────────────────

const ENTITY_LABELS: Record<SearchEntityType, string> = {
  inventory_item: "Inventory Items",
  recipe: "Recipes",
  menu_item: "Menu Items",
  prep_item: "Prep Items",
  vendor_item: "Vendor Items",
  vendor: "Vendors",
  purchase_order: "Purchase Orders",
  menu: "Menus",
  storage_location: "Storage Locations",
  order_guide: "Order Guides",
};

const ENTITY_ORDER: SearchEntityType[] = [
  "inventory_item",
  "recipe",
  "menu_item",
  "prep_item",
  "vendor_item",
  "vendor",
  "purchase_order",
  "menu",
  "storage_location",
  "order_guide",
];

const MATCHED_FIELD_LABELS: Record<string, string> = {
  plu_sku: "PLU",
  barcode: "Barcode",
  vendor_sku: "SKU",
  vendor: "Vendor",
  vendor_name: "Vendor",
};

function EntityIcon({ iconKey, className }: { iconKey: string; className?: string }) {
  const props = { className: className ?? "h-4 w-4 shrink-0 text-muted-foreground" };
  switch (iconKey) {
    case "package":       return <Package {...props} />;
    case "chef-hat":      return <ChefHat {...props} />;
    case "utensils":      return <Utensils {...props} />;
    case "truck":         return <Truck {...props} />;
    case "tag":           return <Tag {...props} />;
    case "shopping-cart": return <ShoppingCart {...props} />;
    case "flame":         return <Flame {...props} />;
    case "book-open":     return <BookOpen {...props} />;
    case "map-pin":       return <MapPin {...props} />;
    case "file-text":     return <FileText {...props} />;
    default:              return <ArrowRight {...props} />;
  }
}

// ── Highlight helper ───────────────────────────────────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded-sm not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type EntityStatus = "idle" | "loading" | "success" | "error";

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { hasFeature } = useTier();

  const [query, setQuery] = useState("");
  // Entity search state — only active for global admin escape hatch
  const [entityResults, setEntityResults] = useState<GlobalSearchResult[]>([]);
  const [entityStatus, setEntityStatus] = useState<EntityStatus>("idle");
  const [showEntityResults, setShowEntityResults] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const openedAt = useRef<number | null>(null);

  const isGlobalAdmin = user?.role === "global_admin";

  // ── Permission-filtered nav routes ────────────────────────────────────────

  const navRoutes = useMemo(() => {
    return ROUTE_CONFIG.filter((r) => {
      // Exclude dynamic routes that require an ID segment
      if (r.route.includes(":")) return false;
      // Exclude mobile-only utility route
      if (r.route === "/dashboard/mobile") return false;
      // Role check
      if (!userMeetsRole(user?.role, r.requiredRole)) return false;
      // Feature flag check
      if (r.requiredFeature && !hasFeature(r.requiredFeature as any)) return false;
      return true;
    });
  }, [user?.role, hasFeature]);

  // ── Query-filtered nav results ────────────────────────────────────────────

  const filteredNavRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navRoutes; // show all permitted destinations when idle
    return navRoutes.filter((r) => {
      const inLabel = r.label.toLowerCase().includes(q);
      const inKeywords = r.keywords ? r.keywords.toLowerCase().includes(q) : false;
      return inLabel || inKeywords;
    });
  }, [navRoutes, query]);

  // Group by section in stable display order
  const groupedNav = useMemo(() => {
    const groups: Partial<Record<NavSection, typeof filteredNavRoutes>> = {};
    for (const section of SECTION_ORDER) {
      const items = filteredNavRoutes.filter((r) => r.section === section);
      if (items.length > 0) groups[section] = items;
    }
    return groups;
  }, [filteredNavRoutes]);

  const hasNavResults = filteredNavRoutes.length > 0;

  // ── Tracking ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      openedAt.current = Date.now();
      track("search_opened");
    } else {
      if (openedAt.current && query.length >= 2) {
        track("search_abandoned", { query_length: query.length });
      }
      openedAt.current = null;
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset on close ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) {
      setQuery("");
      setEntityResults([]);
      setEntityStatus("idle");
      setShowEntityResults(false);
      abortRef.current?.abort();
    }
  }, [open]);

  // ── Entity search (Global Admin only) ────────────────────────────────────

  const doEntitySearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEntityStatus("loading");
    setShowEntityResults(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntityResults(data.results ?? []);
      setEntityStatus("success");
      track("search_entity_query", {
        result_count: (data.results ?? []).length,
        query_length: q.length,
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setEntityStatus("error");
    }
  }, []);

  // ── Selection handlers ────────────────────────────────────────────────────

  const handleNavSelect = useCallback(
    (route: string, label: string) => {
      track("search_nav_selected", { route, label });
      onOpenChange(false);
      navigate(route);
    },
    [navigate, onOpenChange],
  );

  const handleEntitySelect = useCallback(
    (result: GlobalSearchResult) => {
      track("search_entity_selected", { entity_type: result.type });
      onOpenChange(false);
      navigate(result.route);
    },
    [navigate, onOpenChange],
  );

  const handleBackToNav = useCallback(() => {
    setShowEntityResults(false);
    setEntityResults([]);
    setEntityStatus("idle");
    abortRef.current?.abort();
  }, []);

  // ── Entity result grouping ────────────────────────────────────────────────

  const groupedEntity = useMemo(
    () =>
      ENTITY_ORDER.reduce<Record<SearchEntityType, GlobalSearchResult[]>>(
        (acc, type) => {
          acc[type] = entityResults.filter((r) => r.type === type);
          return acc;
        },
        {} as Record<SearchEntityType, GlobalSearchResult[]>,
      ),
    [entityResults],
  );

  const hasEntityResults = entityResults.length > 0;
  const showEntityEscapeHatch =
    isGlobalAdmin && !showEntityResults && query.trim().length >= 2;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-xl gap-0 sm:max-w-xl max-h-[85vh] flex flex-col">
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 flex flex-col flex-1 min-h-0"
        >
          {/* Search input */}
          <CommandInput
            placeholder="Go to…"
            value={query}
            onValueChange={(val) => {
              setQuery(val);
              // Reset entity results when the query changes so nav is
              // always the default view for the new query.
              if (showEntityResults) {
                handleBackToNav();
              }
            }}
            autoFocus
          />

          <CommandList className="flex-1 overflow-y-auto max-h-none">

            {/* ── Entity search mode (Global Admin escape hatch) ─────────── */}
            {showEntityResults && (
              <>
                {/* Back button */}
                <CommandGroup>
                  <CommandItem
                    value="__back_to_nav__"
                    onSelect={handleBackToNav}
                    className="flex items-center gap-2 text-muted-foreground"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    <span className="text-sm">Back to navigation</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />

                {entityStatus === "loading" && (
                  <div className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching data…
                  </div>
                )}

                {entityStatus === "error" && (
                  <div className="py-8 px-4 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-destructive text-sm">
                      <AlertCircle className="h-4 w-4" />
                      Search failed. Please try again.
                    </div>
                    <button
                      onClick={() => doEntitySearch(query)}
                      className="text-xs underline text-muted-foreground hover:text-foreground"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {entityStatus === "success" && !hasEntityResults && (
                  <div className="py-8 px-4 text-center text-sm text-muted-foreground">
                    No data results for <span className="font-medium">"{query}"</span>
                  </div>
                )}

                {entityStatus === "success" && hasEntityResults &&
                  ENTITY_ORDER.map((type, idx) => {
                    const group = groupedEntity[type];
                    if (!group || group.length === 0) return null;
                    return (
                      <div key={type}>
                        {idx > 0 && <CommandSeparator />}
                        <CommandGroup heading={ENTITY_LABELS[type]}>
                          {group.map((result) => (
                            <CommandItem
                              key={`${result.type}-${result.id}`}
                              value={`${result.type}-${result.id}`}
                              onSelect={() => handleEntitySelect(result)}
                              className="flex items-start gap-2 py-2"
                            >
                              <EntityIcon
                                iconKey={result.iconKey}
                                className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5"
                              />
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-sm font-medium leading-snug truncate">
                                  <HighlightMatch text={result.name} query={query} />
                                </span>
                                {result.matchedField !== "name" && (
                                  <span className="text-xs text-muted-foreground italic leading-snug">
                                    Matched {MATCHED_FIELD_LABELS[result.matchedField] ?? result.matchedField}
                                  </span>
                                )}
                                {result.subtitle && (
                                  <span className="text-xs text-muted-foreground leading-snug truncate">
                                    {result.subtitle}
                                  </span>
                                )}
                              </div>
                              <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 mt-1" />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </div>
                    );
                  })
                }
              </>
            )}

            {/* ── Nav search mode (default) ──────────────────────────────── */}
            {!showEntityResults && (
              <>
                {/* Filtered query with no results */}
                {query && !hasNavResults && (
                  <div className="py-8 px-4 text-center text-sm text-muted-foreground">
                    No pages match <span className="font-medium">"{query}"</span>
                  </div>
                )}

                {/* Nav results grouped by section */}
                {SECTION_ORDER.map((section, sectionIdx) => {
                  const items = groupedNav[section];
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={section}>
                      {sectionIdx > 0 && <CommandSeparator />}
                      <CommandGroup heading={SECTION_LABELS[section]}>
                        {items.map((r) => (
                          <CommandItem
                            key={r.route}
                            value={r.route}
                            onSelect={() => handleNavSelect(r.route, r.label)}
                            className="flex items-center gap-2 py-2"
                          >
                            <SectionIcon
                              section={section}
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                            />
                            <span className="text-sm flex-1 truncate">
                              {query
                                ? <HighlightMatch text={r.label} query={query} />
                                : r.label}
                            </span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </div>
                  );
                })}

                {/* Global Admin: entity search escape hatch */}
                {showEntityEscapeHatch && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Data Search">
                      <CommandItem
                        value="__entity_search__"
                        onSelect={() => doEntitySearch(query)}
                        className="flex items-center gap-2 py-2"
                      >
                        <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm flex-1">
                          Search all data for{" "}
                          <span className="font-medium">"{query}"</span>
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </>
            )}
          </CommandList>

          {/* Footer keyboard hints — desktop only */}
          <div className="hidden sm:flex items-center justify-end gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span><kbd className="font-sans">↑↓</kbd> navigate</span>
            <span><kbd className="font-sans">↵</kbd> open</span>
            <span><kbd className="font-sans">Esc</kbd> close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
