import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar as CalendarIcon, Trash2 } from "lucide-react";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useState } from "react";
import type { Company, CompanyStore } from "@shared/schema";

function SessionRow({ count, inventoryItems, stores }: any) {
  const { toast } = useToast();
  
  const { data: countLines } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", count.id],
  });
  
  // Use storeName from count data (includes store name even if user doesn't have access)
  const storeName = count.storeName || 'Unknown Store';
  // Fallback to countedAt for legacy records without countDate
  const countDate = new Date(count.countDate || count.countedAt);
  const createdAt = new Date(count.countedAt);

  const deleteSessionMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/inventory-counts/${count.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      toast({
        title: "Session Deleted",
        description: "Count session and all associated records have been deleted",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete count session",
        variant: "destructive",
      });
    },
  });

  const totalValue = countLines?.reduce((sum, line) => {
    return sum + (line.qty * (line.unitCost || 0));
  }, 0) || 0;

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm("Are you sure you want to delete this count session? This will also delete all count records for this session.")) {
      deleteSessionMutation.mutate();
    }
  };

  return (
    <TableRow data-testid={`row-session-${count.id}`}>
      <TableCell>
        <div className="font-medium">{format(countDate, "PPP")}</div>
        <div className="text-xs text-muted-foreground">
          Created {format(createdAt, "p")}
        </div>
      </TableCell>
      <TableCell data-testid={`text-store-${count.id}`}>{storeName}</TableCell>
      <TableCell>{count.userId}</TableCell>
      <TableCell className="text-right font-mono">{countLines?.length || 0}</TableCell>
      <TableCell className="text-right font-mono font-semibold" data-testid={`text-session-value-${count.id}`}>
        ${totalValue.toFixed(2)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {count.note || '-'}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Link href={`/count/${count.id}`}>
            <Button 
              variant="ghost" 
              size="sm"
              data-testid={`button-view-session-${count.id}`}
            >
              View Details
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleteSessionMutation.isPending}
            data-testid={`button-delete-session-${count.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function InventorySessions() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedStoreId, setSelectedStoreId] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStoreId, setDialogStoreId] = useState<string>("");
  const [countDate, setCountDate] = useState<Date>(new Date());
  const [note, setNote] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Get authenticated user to determine company ID
  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  // For global_admin: use selected company from localStorage
  // For other roles: use user's assigned company
  const selectedCompanyId = user?.role === "global_admin" 
    ? localStorage.getItem("selectedCompanyId")
    : user?.companyId;

  const { data: company } = useQuery<Company>({
    queryKey: selectedCompanyId ? [`/api/companies/${selectedCompanyId}`] : [],
    enabled: !!selectedCompanyId,
  });

  const { data: stores = [] } = useAccessibleStores();

  const { data: inventoryItems } = useQuery<any[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: inventoryCounts, isLoading: countsLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-counts"],
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) {
        throw new Error("No company selected");
      }
      if (!dialogStoreId) {
        throw new Error("Please select a store location to create a count session");
      }
      // Format date as YYYY-MM-DD string to prevent timezone shift
      const year = countDate.getFullYear();
      const month = String(countDate.getMonth() + 1).padStart(2, '0');
      const day = String(countDate.getDate()).padStart(2, '0');
      const countDateStr = `${year}-${month}-${day}`;
      
      const response = await apiRequest("POST", "/api/inventory-counts", {
        userId: "system",
        companyId: selectedCompanyId,
        storeId: dialogStoreId,
        countDate: countDateStr,
        note: note || undefined,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      toast({
        title: "Session Created",
        description: "New inventory count session has been created",
      });
      setDialogOpen(false);
      setDialogStoreId("");
      setNote("");
      setCountDate(new Date());
      setLocation(`/count/${data.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create count session",
        variant: "destructive",
      });
    },
  });

  const handleStartNewCount = () => {
    // Pre-select store if one is already selected in the filter
    if (selectedStoreId !== "all") {
      setDialogStoreId(selectedStoreId);
    }
    // Auto-select if only one store is available
    else if (stores.length === 1) {
      setDialogStoreId(stores[0].id);
    }
    setDialogOpen(true);
  };

  const handleCreateSession = () => {
    if (!dialogStoreId) {
      toast({
        title: "Store Required",
        description: "Please select a store location for this count session",
        variant: "destructive",
      });
      return;
    }
    createSessionMutation.mutate();
  };

  // Get accessible store IDs
  const accessibleStoreIds = new Set(stores.map(s => s.id));
  
  // Filter counts to only show sessions from accessible stores
  const accessibleCounts = inventoryCounts?.filter(count => 
    accessibleStoreIds.has(count.storeId)
  );
  
  // Filter by selected store if not "all"
  const filteredCounts = selectedStoreId === "all" 
    ? accessibleCounts 
    : accessibleCounts?.filter(count => count.storeId === selectedStoreId);

  // Sort counts by date descending (clone array to avoid mutating cache)
  const sortedCounts = filteredCounts ? [...filteredCounts].sort((a, b) => 
    new Date(b.countDate || b.countedAt).getTime() - new Date(a.countDate || a.countedAt).getTime()
  ) : [];

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex-1">
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-sessions-title">
              Inventory Sessions {company && `(${company.name})`}
            </h1>
            <p className="text-muted-foreground mt-2">
              View all inventory count sessions or start a new count
            </p>
          </div>
          <div className="flex items-center gap-4">
            {stores.length === 1 ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/50" data-testid="text-single-store">
                <span className="text-sm font-medium">{stores[0].name}</span>
              </div>
            ) : (
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                <SelectTrigger className="w-[200px]" data-testid="select-store-filter">
                  <SelectValue placeholder="All Stores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-all-stores">All Stores</SelectItem>
                  {stores.map((store) => (
                    <SelectItem 
                      key={store.id} 
                      value={store.id}
                      data-testid={`option-store-${store.id}`}
                    >
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button 
              onClick={handleStartNewCount}
              disabled={createSessionMutation.isPending}
              data-testid="button-start-new-session"
            >
              <Plus className="h-4 w-4 mr-2" />
              Start New Count
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-new-session">
          <DialogHeader>
            <DialogTitle>Start New Inventory Count</DialogTitle>
            <DialogDescription>
              Select the store location, inventory date, and add any notes for this count session
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="dialog-store">Store Location *</Label>
              <Select value={dialogStoreId} onValueChange={setDialogStoreId}>
                <SelectTrigger id="dialog-store" data-testid="select-dialog-store">
                  <SelectValue placeholder="Select a store..." />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem 
                      key={store.id} 
                      value={store.id}
                      data-testid={`option-dialog-store-${store.id}`}
                    >
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="count-date">Inventory Date of Record</Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="count-date"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !countDate && "text-muted-foreground"
                    )}
                    data-testid="button-select-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {countDate ? format(countDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={countDate}
                    onSelect={(date) => {
                      if (date) {
                        setCountDate(date);
                        setDatePickerOpen(false); // Close popover after selection
                      }
                    }}
                    initialFocus
                    data-testid="calendar-count-date"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Note (Optional)</Label>
              <Input
                id="note"
                placeholder="e.g., Monthly count, End of quarter..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="input-count-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-session"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateSession}
              disabled={createSessionMutation.isPending}
              data-testid="button-create-session"
            >
              {createSessionMutation.isPending ? "Creating..." : "Create Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CalendarIcon className="h-5 w-5 text-muted-foreground" />
            <CardTitle>All Count Sessions</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {countsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : sortedCounts && sortedCounts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inventory Date</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCounts.map((count) => (
                  <SessionRow 
                    key={count.id} 
                    count={count}
                    inventoryItems={inventoryItems}
                    stores={stores}
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p className="mb-4">No inventory count sessions found</p>
              <Button 
                onClick={handleStartNewCount}
                disabled={createSessionMutation.isPending}
                data-testid="button-first-session"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Count Session
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
