import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, ChevronLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { COLUMN_DEFS, REPORT_LABELS } from "./reportColumnDefs";
import type { ReportTypeValue } from "@shared/schema";

const REPORT_TYPES: ReportTypeValue[] = ["recipe_cost", "inventory_value", "purchase_activity"];

function getQueryParam(search: string, key: string): string {
  return new URLSearchParams(search).get(key) ?? "";
}

export default function ReportViewer() {
  const [location] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const { user } = useAuth();
  const { data: stores = [] } = useAccessibleStores();

  const initialType = (getQueryParam(search, "type") || "recipe_cost") as ReportTypeValue;
  const [reportType, setReportType] = useState<ReportTypeValue>(initialType);
  const [storeId, setStoreId] = useState(getQueryParam(search, "storeId"));
  const [dateFrom, setDateFrom] = useState(getQueryParam(search, "dateFrom"));
  const [dateTo, setDateTo] = useState(getQueryParam(search, "dateTo"));
  const [shouldFetch, setShouldFetch] = useState(true);

  // Auto-run on first load
  const [runKey, setRunKey] = useState(0);

  const queryParams = new URLSearchParams();
  queryParams.set("reportType", reportType);
  if (storeId)   queryParams.set("storeId", storeId);
  if (dateFrom)  queryParams.set("dateFrom", dateFrom);
  if (dateTo)    queryParams.set("dateTo", dateTo);

  const { data, isLoading, isError, refetch } = useQuery<{ rows: any[]; reportType: string; count: number }>({
    queryKey: [`/api/reports/run`, reportType, storeId, dateFrom, dateTo, runKey],
    queryFn: async () => {
      const res = await fetch(`/api/reports/run?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: shouldFetch,
  });

  const rows = data?.rows ?? [];
  const cols = COLUMN_DEFS[reportType] ?? [];

  function handleRun() {
    setShouldFetch(true);
    setRunKey(k => k + 1);
  }

  function handleExport() {
    window.location.href = `/api/reports/export?${queryParams.toString()}`;
  }

  const showDateFilters = reportType === "purchase_activity";
  const showStoreFilter = reportType === "inventory_value" || reportType === "purchase_activity";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Nav */}
      <div className="flex items-center gap-2">
        <Link href="/reports">
          <Button variant="ghost" size="sm" className="gap-1 -ml-2">
            <ChevronLeft className="h-4 w-4" />
            Reports
          </Button>
        </Link>
      </div>

      {/* Header + controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1 min-w-[200px]">
          <Label>Report type</Label>
          <Select value={reportType} onValueChange={v => { setReportType(v as ReportTypeValue); setShouldFetch(false); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_TYPES.map(t => (
                <SelectItem key={t} value={t}>{REPORT_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showStoreFilter && (
          <div className="space-y-1 min-w-[180px]">
            <Label>Location</Label>
            <Select value={storeId || "all"} onValueChange={v => { setStoreId(v === "all" ? "" : v); setShouldFetch(false); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {(stores ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showDateFilters && (
          <>
            <div className="space-y-1">
              <Label>From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setShouldFetch(false); }}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setShouldFetch(false); }}
                className="w-[160px]"
              />
            </div>
          </>
        )}

        <div className="flex gap-2 ml-auto">
          <Button onClick={handleRun} disabled={isLoading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Run
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={rows.length === 0} className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Results */}
      {isError && (
        <p className="text-destructive text-sm">Failed to load report. Please try again.</p>
      )}

      {!isLoading && rows.length === 0 && !isError && (
        <p className="text-muted-foreground text-sm text-center py-16">
          No data found for the selected filters.
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{rows.length.toLocaleString()} row{rows.length !== 1 ? "s" : ""}</p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {cols.map(col => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 font-medium whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"}`}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    {cols.map(col => (
                      <td
                        key={col.key}
                        className={`px-4 py-2.5 whitespace-nowrap ${col.align === "right" ? "text-right tabular-nums" : ""}`}
                      >
                        {col.format ? col.format(row[col.key]) : (row[col.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
