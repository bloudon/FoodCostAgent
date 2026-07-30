import { useState, useEffect, useRef, useCallback } from "react";
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
  Package,
  ChefHat,
  Utensils,
  Truck,
  Tag,
  ShoppingCart,
  Flame,
  BookOpen,
  MapPin,
  FileText,
  Loader2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { track } from "@/lib/analytics";

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Constants ──────────────────────────────────────────────────────────────

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

// Stable display order (matches PM spec)
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

// ── Icons ──────────────────────────────────────────────────────────────────

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

type SearchStatus = "idle" | "min-chars" | "loading" | "success" | "error";

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedAt = useRef<number | null>(null);

  // Track search opened
  useEffect(() => {
    if (open) {
      openedAt.current = Date.now();
      track("search_opened");
    } else {
      // Track abandonment if closed without selecting
      if (openedAt.current && query.length >= 2 && status !== "success") {
        track("search_abandoned", { query_length: query.length });
      }
      openedAt.current = null;
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setStatus("idle");
      abortRef.current?.abort();
    }
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setStatus(q.length === 0 ? "idle" : "min-chars");
      abortRef.current?.abort();
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    const startTime = Date.now();

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const elapsed = Date.now() - startTime;

      setResults(data.results ?? []);
      setStatus("success");

      track("search_query_submitted", {
        result_count: (data.results ?? []).length,
        response_time_ms: elapsed,
      });

      if ((data.results ?? []).length === 0) {
        track("search_no_results", { query_length: q.length });
      }
    } catch (err: any) {
      if (err.name === "AbortError") return; // Stale — ignore
      setStatus("error");
    }
  }, []);

  // Debounced input handler
  const handleQueryChange = useCallback(
    (val: string) => {
      setQuery(val);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (val.length === 0) {
        setResults([]);
        setStatus("idle");
        abortRef.current?.abort();
        return;
      }
      if (val.length === 1) {
        setResults([]);
        setStatus("min-chars");
        abortRef.current?.abort();
        return;
      }

      debounceRef.current = setTimeout(() => {
        doSearch(val);
      }, 250);
    },
    [doSearch]
  );

  const handleSelect = useCallback(
    (result: GlobalSearchResult) => {
      track("search_result_selected", {
        entity_type: result.type,
        matched_field: result.matchedField,
      });
      onOpenChange(false);
      navigate(result.route);
    },
    [navigate, onOpenChange]
  );

  // Group results by entity type in stable order
  const grouped = ENTITY_ORDER.reduce<Record<SearchEntityType, GlobalSearchResult[]>>(
    (acc, type) => {
      acc[type] = results.filter((r) => r.type === type);
      return acc;
    },
    {} as Record<SearchEntityType, GlobalSearchResult[]>
  );

  const hasResults = results.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-xl gap-0 sm:max-w-xl max-h-[85vh] flex flex-col">
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 flex flex-col flex-1 min-h-0"
        >
          {/* Input */}
          <CommandInput
            placeholder="Search recipes, inventory, vendors…"
            value={query}
            onValueChange={handleQueryChange}
            autoFocus
          />

          {/* State area */}
          <CommandList className="flex-1 overflow-y-auto max-h-none">

            {/* Idle: guidance */}
            {status === "idle" && (
              <div className="py-8 px-4 text-center text-sm text-muted-foreground space-y-1">
                <p>Search across recipes, inventory, vendors, and more.</p>
                <p className="text-xs">Type at least 2 characters to begin.</p>
              </div>
            )}

            {/* Min-chars */}
            {status === "min-chars" && (
              <div className="py-6 px-4 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search.
              </div>
            )}

            {/* Loading */}
            {status === "loading" && (
              <div className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </div>
            )}

            {/* Error */}
            {status === "error" && (
              <div className="py-8 px-4 text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" />
                  Search failed. Please try again.
                </div>
                <button
                  onClick={() => doSearch(query)}
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                >
                  Retry
                </button>
              </div>
            )}

            {/* No results */}
            {status === "success" && !hasResults && (
              <div className="py-8 px-4 text-center text-sm text-muted-foreground">
                No results for <span className="font-medium">"{query}"</span>
              </div>
            )}

            {/* Results grouped by entity type */}
            {status === "success" && hasResults &&
              ENTITY_ORDER.map((type, idx) => {
                const group = grouped[type];
                if (!group || group.length === 0) return null;
                return (
                  <div key={type}>
                    {idx > 0 && <CommandSeparator />}
                    <CommandGroup heading={ENTITY_LABELS[type]}>
                      {group.map((result) => (
                        <CommandItem
                          key={`${result.type}-${result.id}`}
                          value={`${result.type}-${result.id}`}
                          onSelect={() => handleSelect(result)}
                          className="flex items-start gap-2 py-2"
                        >
                          <EntityIcon iconKey={result.iconKey} className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm font-medium leading-snug truncate">
                              <HighlightMatch text={result.name} query={query} />
                            </span>
                            {/* Matched-field note when match is not on the visible name */}
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
              })}
          </CommandList>

          {/* Footer hint — desktop only */}
          {(status === "success" || status === "idle") && (
            <div className="hidden sm:flex items-center justify-end gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
              <span><kbd className="font-sans">↑↓</kbd> navigate</span>
              <span><kbd className="font-sans">↵</kbd> open</span>
              <span><kbd className="font-sans">Esc</kbd> close</span>
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
