import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, Trash2 } from "lucide-react";
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
import { useState } from "react";
import type { Company, CompanyStore } from "@shared/schema";

function SessionRow({ count, countDate, inventoryItems }: any) {
  const { toast } = useToast();
  
  const { data: countLines } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", count.id],
  });

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
      <TableCell className="font-mono">
        {countDate.toLocaleDateString()} {countDate.toLocaleTimeString()}
      </TableCell>
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

  const selectedCompanyId = localStorage.getItem("selectedCompanyId");

  const { data: company } = useQuery<Company>({
    queryKey: selectedCompanyId ? [`/api/companies/${selectedCompanyId}`] : [],
    enabled: !!selectedCompanyId,
  });

  const { data: stores = [] } = useQuery<CompanyStore[]>({
    queryKey: selectedCompanyId ? [`/api/companies/${selectedCompanyId}/stores`] : [],
    enabled: !!selectedCompanyId,
  });

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
      if (selectedStoreId === "all" || !selectedStoreId) {
        throw new Error("Please select a store location to create a count session");
      }
      const response = await apiRequest("POST", "/api/inventory-counts", {
        userId: "system",
        companyId: selectedCompanyId,
        storeId: selectedStoreId,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      toast({
        title: "Session Created",
        description: "New inventory count session has been created",
      });
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
    createSessionMutation.mutate();
  };

  // Filter counts by store if selected (don't mutate original array)
  const filteredCounts = selectedStoreId === "all" 
    ? inventoryCounts 
    : inventoryCounts?.filter(count => count.storeId === selectedStoreId);

  // Sort counts by date descending (clone array to avoid mutating cache)
  const sortedCounts = filteredCounts ? [...filteredCounts].sort((a, b) => 
    new Date(b.countedAt).getTime() - new Date(a.countedAt).getTime()
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
            <Button 
              onClick={handleStartNewCount}
              disabled={createSessionMutation.isPending}
              data-testid="button-start-new-session"
            >
              <Plus className="h-4 w-4 mr-2" />
              {createSessionMutation.isPending ? "Creating..." : "Start New Count"}
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-muted-foreground" />
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
                  <TableHead>Date & Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCounts.map((count) => {
                  const countDate = new Date(count.countedAt);
                  return (
                    <SessionRow 
                      key={count.id} 
                      count={count} 
                      countDate={countDate}
                      inventoryItems={inventoryItems}
                    />
                  );
                })}
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
