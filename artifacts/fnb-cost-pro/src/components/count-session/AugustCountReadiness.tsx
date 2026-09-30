import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ClipboardCheck, MapPin } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";

interface ReadinessItem {
  inventoryItemId: string;
  name: string;
  locations: { id: string; name: string }[];
}

interface ReadinessException {
  id: string;
  name: string;
  reason: string;
}

interface ReadinessLocation {
  id: string;
  name: string;
  itemCount: number;
}

interface CountReadinessResponse {
  storeId: string;
  activeItems: ReadinessItem[];
  totalLines: number;
  unassigned: ReadinessException[];
  blocked: ReadinessException[];
  locations: ReadinessLocation[];
}

interface CountLine {
  inventoryItemId?: string | null;
  storageLocationId?: string | null;
}

export interface AugustCountReadinessProps {
  countId: string;
  storeId: string;
  countLines?: CountLine[] | null;
}

export default function AugustCountReadiness({ countId, storeId, countLines }: AugustCountReadinessProps) {
  const { data, isLoading, error } = useQuery<CountReadinessResponse>({
    queryKey: ["/api/inventory-counts/readiness", storeId, countId],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId });
      const response = await apiRequest("GET", `/api/inventory-counts/readiness?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(storeId),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const missingItemLocations = useMemo(() => {
    if (!data || !countLines) return [];
    const linePairs = new Set(
      countLines
        .filter((line) => line?.inventoryItemId && line?.storageLocationId)
        .map((line) => `${line.inventoryItemId}\u0000${line.storageLocationId}`),
    );
    return data.activeItems.flatMap((item) =>
      item.locations
        .filter((location) => !linePairs.has(`${item.inventoryItemId}\u0000${location.id}`))
        .map((location) => ({
          id: `${item.inventoryItemId}-${location.id}`,
          name: item.name,
          reason: `Missing count line at ${location.name}.`,
        })),
    );
  }, [data, countLines]);

  return (
    <Card data-testid="card-count-readiness">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          Count session readiness
        </CardTitle>
        <CardDescription>
          Active-item coverage and setup exceptions for this store. A session line or a zero quantity alone does not confirm a physical reading.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="h-4 w-44 animate-pulse rounded bg-muted" />
            <div className="h-16 animate-pulse rounded bg-muted" />
            <span className="sr-only">Loading count readiness…</span>
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="alert-count-readiness-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Unable to load count readiness</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "An unknown error occurred."}
            </AlertDescription>
          </Alert>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Count readiness is unavailable.</p>
        ) : (
          <>
            <section aria-label="Storage location summary" data-testid="summary-count-locations">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                {data.locations.length === 0
                  ? "No active-item locations"
                  : `${data.locations.length} ${data.locations.length === 1 ? "location" : "locations"} · ${data.totalLines} assigned item-location ${data.totalLines === 1 ? "line" : "lines"}`}
              </div>
              {data.locations.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {data.locations.map((location) => (
                    <li
                      key={location.id}
                      data-testid={`location-count-readiness-${location.id}`}
                      className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-medium">{location.name}</span>
                      <span className="ml-1.5 text-muted-foreground">
                        {location.itemCount} {location.itemCount === 1 ? "item" : "items"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {countLines == null ? (
              <p className="text-sm text-muted-foreground" role="status" data-testid="status-session-lines-pending">
                Waiting for this session’s lines before checking active-item coverage.
              </p>
            ) : (
              <ReadinessList
                title="Assigned item-location lines missing from this session"
                items={missingItemLocations}
                emptyMessage={`${data.totalLines} assigned item-location lines represented in the session (not necessarily physically entered).`}
                testId="missing-active-items"
              />
            )}

            <ReadinessList
              title="Unassigned items"
              items={data.unassigned}
              emptyMessage="No active items are missing a storage location."
              testId="unassigned-items"
            />
            <ReadinessList
              title="Blocked items"
              items={data.blocked}
              emptyMessage="No active items have count setup blockers."
              testId="blocked-items"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReadinessList({
  title,
  items,
  emptyMessage,
  testId,
}: {
  title: string;
  items: ReadinessException[];
  emptyMessage: string;
  testId: string;
}) {
  return (
    <section data-testid={`section-${testId}`}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {items.length === 0 && <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />}
        <span>{title}</span>
        <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <details className="rounded-md border">
          <summary
            className="cursor-pointer px-3 py-2 text-sm text-muted-foreground"
            data-testid={`toggle-${testId}`}
          >
            Show {items.length} {items.length === 1 ? "item" : "items"}
          </summary>
          <ul className="space-y-2 border-t px-3 py-2">
            {items.map((item) => (
              <li key={item.id} data-testid={`readiness-item-${testId}-${item.id}`} className="text-sm">
                <div className="font-medium">{item.name}</div>
                {item.reason && <div className="text-xs text-muted-foreground">{item.reason}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}