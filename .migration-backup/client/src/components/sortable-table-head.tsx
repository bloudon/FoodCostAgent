import { useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function SortableTableHead({
  field,
  sortField,
  sortDirection,
  onSort,
  className,
  children,
}: {
  field: string;
  sortField: string;
  sortDirection: "asc" | "desc";
  onSort: (field: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = sortField === field;
  return (
    <TableHead
      className={cn("cursor-pointer select-none whitespace-nowrap", className)}
      onClick={() => onSort(field)}
      data-testid={`sort-header-${field}`}
    >
      <div className="flex items-center gap-1">
        {children}
        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUp className="h-3 w-3 shrink-0" />
          ) : (
            <ArrowDown className="h-3 w-3 shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
        )}
      </div>
    </TableHead>
  );
}

export function useTableSort<T extends string>(defaultField: T, defaultDir: "asc" | "desc" = "asc") {
  const [sortField, setSortField] = useState<T>(defaultField);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(defaultDir);

  const handleSort = (field: string) => {
    const f = field as T;
    if (sortField === f) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(f);
      setSortDirection("asc");
    }
  };

  return { sortField, sortDirection, handleSort };
}

export function sortData<T>(
  data: T[],
  sortField: string,
  sortDirection: "asc" | "desc",
  getField: (item: T, field: string) => string | number | null | undefined
): T[] {
  return [...data].sort((a, b) => {
    const av = getField(a, sortField);
    const bv = getField(b, sortField);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
    }
    return sortDirection === "asc" ? cmp : -cmp;
  });
}
