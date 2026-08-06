import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ScanLine, ChevronRight, Store, Package, Camera, AlertCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useStoreContext } from "@/hooks/use-store-context";

interface ShelfItem {
  name: string;
  quantity: number;
  unit: string;
  confidence: "high" | "medium" | "low";
}

interface ShelfScanSession {
  id: string;
  companyId: string;
  storeId: string | null;
  userId: string | null;
  createdAt: string;
  frameCount: number;
  itemCount: number;
  items: ShelfItem[];
  notes: string[];
  status: string;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function ConfidenceBadge({ level }: { level: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[level] || CONFIDENCE_COLORS.medium}`}
    >
      {level}
    </span>
  );
}

function SessionDetailDrawer({
  session,
  storeName,
  open,
  onClose,
}: {
  session: ShelfScanSession | null;
  storeName: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!session) return null;

  const items: ShelfItem[] = Array.isArray(session.items) ? session.items : [];
  const notes: string[] = Array.isArray(session.notes) ? session.notes : [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="drawer-scan-detail">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            Scan Detail
          </SheetTitle>
          <SheetDescription>
            {format(new Date(session.createdAt), "PPPp")}
            {storeName && ` · ${storeName}`}
            {` · ${session.frameCount} frame${session.frameCount !== 1 ? "s" : ""}`}
          </SheetDescription>
        </SheetHeader>

        {notes.length > 0 && (
          <div className="mb-4 rounded-md border bg-muted/40 p-3 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">AI Notes</p>
            {notes.map((note, i) => (
              <p key={i} className="text-sm text-muted-foreground">{note}</p>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <AlertCircle className="h-8 w-8" />
            <p className="text-sm">No items detected in this scan.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={idx} data-testid={`row-item-${idx}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-right font-mono">{item.quantity}</TableCell>
                  <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                  <TableCell>
                    <ConfidenceBadge level={item.confidence} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function ShelfScans() {
  const { selectedStoreId } = useStoreContext();
  const { data: stores = [] } = useAccessibleStores();

  const [filterStoreId, setFilterStoreId] = useState<string>("all");
  const [selectedSession, setSelectedSession] = useState<ShelfScanSession | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const queryStoreId = filterStoreId === "all" ? undefined : filterStoreId;

  const { data: sessions = [], isLoading } = useQuery<ShelfScanSession[]>({
    queryKey: ["/api/shelf-scan-sessions", queryStoreId],
    queryFn: async () => {
      const url = queryStoreId
        ? `/api/shelf-scan-sessions?storeId=${queryStoreId}`
        : "/api/shelf-scan-sessions";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load shelf scan sessions");
      return res.json();
    },
  });

  const storeMap = Object.fromEntries(stores.map((s) => [s.id, s.name]));

  function openSession(session: ShelfScanSession) {
    setSelectedSession(session);
    setDrawerOpen(true);
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-shelf-scans-title">
            <ScanLine className="h-6 w-6" />
            Shelf Scans
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review sweep-scan sessions captured from the mobile app.
          </p>
        </div>

        {stores.length > 1 && (
          <Select value={filterStoreId} onValueChange={setFilterStoreId}>
            <SelectTrigger className="w-48" data-testid="select-store-filter">
              <Store className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="option-all-stores">All Stores</SelectItem>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id} data-testid={`option-store-${store.id}`}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4 text-muted-foreground">
            <Camera className="h-12 w-12 opacity-30" />
            <div className="text-center">
              <p className="font-medium text-base">No scan sessions yet</p>
              <p className="text-sm mt-1 max-w-sm">
                Open the FNB Cost Pro mobile app, navigate to "Sweep Scan", take 1–5 shelf photos, and submit. Each completed scan will appear here automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date &amp; Time</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-center">Frames</TableHead>
                  <TableHead className="text-center">Items Found</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session, idx) => {
                  const storeName = session.storeId ? (storeMap[session.storeId] || "Unknown Store") : "—";
                  const rowClass = idx % 2 === 1 ? "bg-muted/30" : "";
                  return (
                    <TableRow
                      key={session.id}
                      className={`cursor-pointer hover-elevate ${rowClass}`}
                      onClick={() => openSession(session)}
                      data-testid={`row-session-${session.id}`}
                    >
                      <TableCell>
                        <p className="font-medium">
                          {format(new Date(session.createdAt), "PPP")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(session.createdAt), "p")}
                        </p>
                      </TableCell>
                      <TableCell data-testid={`text-store-${session.id}`}>
                        {storeName}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono">{session.frameCount}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono font-semibold" data-testid={`text-item-count-${session.id}`}>
                            {session.itemCount}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="capitalize">
                          {session.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <SessionDetailDrawer
        session={selectedSession}
        storeName={selectedSession?.storeId ? (storeMap[selectedSession.storeId] || "") : ""}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
