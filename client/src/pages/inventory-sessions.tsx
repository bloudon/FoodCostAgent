import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar } from "lucide-react";
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

function SessionRow({ count, countDate, inventoryItems }: any) {
  const { data: countLines } = useQuery<any[]>({
    queryKey: ["/api/inventory-count-lines", count.id],
  });

  const totalValue = countLines?.reduce((sum, line) => {
    return sum + (line.qty * (line.unitCost || 0));
  }, 0) || 0;

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
        <Link href={`/count/${count.id}`}>
          <Button 
            variant="ghost" 
            size="sm"
            data-testid={`button-view-session-${count.id}`}
          >
            View Details
          </Button>
        </Link>
      </TableCell>
    </TableRow>
  );
}

export default function InventorySessions() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: inventoryItems } = useQuery<any[]>({
    queryKey: ["/api/inventory-items"],
  });

  const { data: inventoryCounts, isLoading: countsLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory-counts"],
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/inventory-counts", {
        userId: "system",
        lines: [],
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

  // Sort counts by date descending
  const sortedCounts = inventoryCounts?.sort((a, b) => 
    new Date(b.countedAt).getTime() - new Date(a.countedAt).getTime()
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-sessions-title">
              Inventory Sessions
            </h1>
            <p className="text-muted-foreground mt-2">
              View all inventory count sessions or start a new count
            </p>
          </div>
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
