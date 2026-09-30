import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileSpreadsheet, RefreshCw, Scale } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";

interface AugustReferenceRow {
  lineId: string;
  itemName: string;
  locationName: string | null;
  physicalQty: string | number | null;
  physicalUnit: string | null;
  sourceQty: string | number | null;
  sourceUnit: string | null;
  comparisonUnit: string | null;
  factor: number | null;
  sourceComparableQty: number | null;
  difference: number | null;
  status: string;
  reason: string | null;
  rowIndexes: number[];
}

interface AugustUnresolvedRow {
  status: string;
  reason?: string | null;
  lineId?: string | null;
  itemName?: string | null;
  locationName?: string | null;
  inventoryItemId?: string | null;
  sourceLocation?: string | null;
  sourceUnit?: string | null;
  sourceQuantity?: string | number | null;
  sourceQty?: string | number | null;
  physicalQty?: string | number | null;
  physicalUnit?: string | null;
  rowIndex?: number;
  rowIndexes?: number[];
  explanation?: string;
}

interface AugustReferenceResponse {
  batch: { date: string; filename: string | null } | null;
  rows: AugustReferenceRow[];
  unresolved: AugustUnresolvedRow[];
}

export interface AugustOrderlyReferenceProps {
  countId: string;
}

type DisplayRow = {
  key: string;
  item: string;
  location: string;
  physicalQuantity: string;
  sourceQuantity: string;
  status: string;
  explanation?: string;
  factor?: number;
  commonUnit?: string;
  comparableSourceQuantity?: number;
  difference?: number;
};

function quantity(value: string | number | null | undefined, unit?: string | null): string {
  if (value == null || value === "") return "—";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
}

function statusLabel(status: string): string {
  if (status === "comparable") return "Comparable";
  if (status === "not_entered") return "Not yet entered";
  if (status === "duplicate_source") return "Duplicate source";
  if (status === "unmatched_item" || status === "unresolved_item") return "Missing item identity";
  if (status === "unresolved_location") return "Missing / unresolved location";
  if (status === "unresolved_unit") return "Missing / unresolved unit";
  if (status === "unresolved_tiers") return "Unresolved source quantity";
  if (status === "missing_reference") return "Missing Orderly reference";
  return "Unresolved";
}

function StatusBadge({ status }: { status: string }) {
  return status === "comparable"
    ? <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Comparable</Badge>
    : <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">{statusLabel(status)}</Badge>;
}

export default function AugustOrderlyReference({ countId }: AugustOrderlyReferenceProps) {
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(200);
  const { data, isLoading, error, refetch, isFetching } = useQuery<AugustReferenceResponse>({
    queryKey: ["/api/inventory-counts", countId, "august-reference"],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/inventory-counts/${countId}/august-reference`);
      return response.json();
    },
    enabled: Boolean(countId),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const rows = useMemo<DisplayRow[]>(() => {
    if (!data) return [];
    const countRows: DisplayRow[] = data.rows.map((line) => ({
      key: `count-${line.lineId}`,
      item: line.itemName || "Unknown item",
      location: line.locationName || "Unknown location",
      physicalQuantity: quantity(line.physicalQty, line.physicalUnit),
      sourceQuantity: quantity(line.sourceQty, line.sourceUnit),
      status: line.status,
      explanation: line.reason || undefined,
      factor: line.status === "comparable" ? line.factor ?? undefined : undefined,
      commonUnit: line.status === "comparable" ? line.comparisonUnit ?? undefined : undefined,
      comparableSourceQuantity: line.status === "comparable" ? line.sourceComparableQty ?? undefined : undefined,
      difference: line.status === "comparable" ? line.difference ?? undefined : undefined,
    }));
    const representedLineIds = new Set(data.rows.map((line) => line.lineId));
    const unresolvedRows: DisplayRow[] = data.unresolved
      .filter((entry) => !entry.lineId || !representedLineIds.has(entry.lineId))
      .map((entry, index) => {
        const rowIndex = entry.rowIndex ?? entry.rowIndexes?.[0];
        return {
          key: `unresolved-${entry.lineId || rowIndex || index}`,
          item: entry.itemName || (entry.inventoryItemId ? "Orderly item (no count line)" : rowIndex != null ? `Orderly source row #${rowIndex}` : "Orderly reference"),
          location: entry.locationName || entry.sourceLocation || "Unknown location",
          physicalQuantity: entry.status === "not_entered"
            ? "Not entered"
            : quantity(entry.physicalQty, entry.physicalUnit),
          sourceQuantity: quantity(entry.sourceQty ?? entry.sourceQuantity, entry.sourceUnit),
          status: entry.status,
          explanation: entry.reason || entry.explanation,
        };
      });
    return [...countRows, ...unresolvedRows];
  }, [data]);

  const locations = useMemo(
    () => [...new Set(rows.map((row) => row.location))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const statuses = useMemo(
    () => [...new Set(rows.map((row) => row.status))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const visibleRows = rows.filter((row) =>
    (locationFilter === "all" || row.location === locationFilter) &&
    (statusFilter === "all" || row.status === statusFilter),
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              August 31 Orderly reference
            </CardTitle>
            <CardDescription className="mt-1">
              Read-only comparison to the dated Orderly workbook. This reference never changes count entries or inventory.
            </CardDescription>
          </div>
          <button type="button" onClick={() => refetch()} disabled={isFetching}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            aria-label="Refresh August comparison">
            <RefreshCw className="h-3 w-3" /> Refresh after entry
          </button>
          {data?.batch && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                {data.batch.filename || "Orderly workbook"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Source date: {data.batch.date}
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-16 animate-pulse rounded bg-muted" />
            <span className="sr-only">Loading August Orderly comparison…</span>
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Unable to load August reference</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "An unknown error occurred."}
            </AlertDescription>
          </Alert>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">August reference is unavailable.</p>
        ) : data.batch === null && data.unresolved.some((entry) => entry.status === "missing_reference") ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>August Orderly reference is not available</AlertTitle>
            <AlertDescription>
              {data.unresolved.find((entry) => entry.status === "missing_reference")?.reason
                || "No approved Orderly workbook is available for August 31, 2026."}
            </AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No count lines or Orderly source rows are available for comparison.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="w-full sm:max-w-xs">
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger aria-label="Filter by location">
                    <SelectValue placeholder="All locations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All locations</SelectItem>
                    {locations.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:max-w-xs">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger aria-label="Filter by comparison status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {statuses.map((status) => <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {visibleRows.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No rows match these filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item / location</TableHead>
                      <TableHead>Physical count</TableHead>
                      <TableHead>Orderly source ({data.batch?.date || "2026-08-31"})</TableHead>
                      <TableHead>Common unit / factor</TableHead>
                      <TableHead>Difference</TableHead>
                      <TableHead>Status / reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.slice(0, visibleLimit).map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <div className="font-medium">{row.item}</div>
                          <div className="text-xs text-muted-foreground">{row.location}</div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{row.physicalQuantity}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {row.sourceQuantity}
                          {row.status === "comparable" && row.comparableSourceQuantity != null && row.commonUnit && (
                            <div className="text-xs text-muted-foreground">
                              = {formatNumber(row.comparableSourceQuantity)} {row.commonUnit}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="min-w-40">
                          {row.status === "comparable" && row.factor != null && row.commonUnit ? (
                            <div>
                              <div>{row.commonUnit}</div>
                              <div className="text-xs text-muted-foreground">
                                1 source unit = {formatNumber(row.factor)} {row.commonUnit}
                              </div>
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="font-mono whitespace-nowrap">
                          {row.status === "comparable" && row.difference != null && Number.isFinite(row.difference)
                            ? `${row.difference > 0 ? "+" : ""}${formatNumber(row.difference)} ${row.commonUnit || ""}`.trim()
                            : "—"}
                        </TableCell>
                        <TableCell className="min-w-52">
                          <StatusBadge status={row.status} />
                          {row.explanation && <div className="mt-1 text-xs text-muted-foreground">{row.explanation}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {visibleRows.length > visibleLimit && (
              <button type="button" className="rounded border px-3 py-2 text-sm hover:bg-muted"
                onClick={() => setVisibleLimit((limit) => limit + 200)}>
                Show more ({visibleLimit} of {visibleRows.length} rows shown)
              </button>
            )}
            <p className="text-xs text-muted-foreground">
              Differences are shown only for rows explicitly marked comparable. Unresolved and not-yet-entered rows are never treated as zero.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}