import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { AlertCircle, ChevronRight, Loader2, MapPin, Package, AlertTriangle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface LocationReviewDialogProps {
  countId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectLine: (lineId: string, itemId: string, locationName: string | null) => void;
}

interface LocationReviewResponse {
  warnings: Array<{
    lineId: string;
    itemId: string;
    itemName: string;
    sourceItemCode: string;
    currentLocationName: string | null;
    supportedLocationName: string | null;
    qty: string | null;
    caseQty: string | null;
    containerQty: string | null;
    looseUnits: string | null;
    entryCount: number;
    reason: string;
    eligibleForRemoval: boolean;
  }>;
  canRemove: boolean;
  blockers: string[];
}

export function LocationReviewDialog({ countId, isOpen, onOpenChange, onSelectLine }: LocationReviewDialogProps) {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [showConfirm, setShowConfirm] = useState(false);

  const { data, isLoading, error } = useQuery<LocationReviewResponse>({
    queryKey: ["/api/inventory-counts", countId, "location-review"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory-counts/${countId}/location-review`);
      return res.json();
    },
    enabled: isOpen,
    staleTime: 0,
    refetchOnMount: true,
  });

  const resolveMutation = useMutation({
    mutationFn: async (expectedLineIds: string[]) => {
      const res = await apiRequest("POST", `/api/inventory-counts/${countId}/location-review/resolve`, {
        expectedLineIds,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId, "previous-lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-count-lines", countId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts", countId, "location-review"] });

      toast({
        title: "Warnings Resolved",
        description: `Removed ${data.removed} unsupported ${data.removed === 1 ? "line" : "lines"}.`,
      });
      setShowConfirm(false);
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Error resolving warnings",
        description: err instanceof Error ? err.message : "An unknown error occurred.",
        variant: "destructive",
      });
      setShowConfirm(false);
    }
  });

  const handleResolve = () => {
    if (!data?.canRemove) return;
    const expectedLineIds = data.warnings
      .filter((w) => w.eligibleForRemoval)
      .map((w) => w.lineId);

    resolveMutation.mutate(expectedLineIds);
  };

  const handleLineClick = (lineId: string, itemId: string, locationName: string | null) => {
    onSelectLine(lineId, itemId, locationName);
    onOpenChange(false);
  };

  const content = (
    <div className="flex flex-col h-full gap-4 py-4">
      {isLoading ? (
        <div className="flex items-center justify-center flex-1 min-h-[200px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error loading warnings</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "An unknown error occurred."}
          </AlertDescription>
        </Alert>
      ) : data ? (
        <>
          {data.blockers?.length > 0 && (
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Cannot Remove</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-2 space-y-1 text-sm">
                  {data.blockers.map((blocker, i) => (
                    <li key={i}>{blocker}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {data.warnings?.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 min-h-[200px] text-center text-muted-foreground">
              <Package className="h-12 w-12 mb-4 opacity-20" />
              <p>No location warnings found.</p>
            </div>
          ) : (
            <ScrollArea className="flex-1 -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="space-y-3 pb-4">
                {data.warnings.map((warning) => (
                  <div
                    key={warning.lineId}
                    className="flex flex-col gap-2 p-3 rounded-lg border bg-card/50 text-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{warning.itemName}</span>
                          {warning.sourceItemCode && (
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 opacity-70">
                              {warning.sourceItemCode}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-2">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>
                            {warning.currentLocationName || "Unknown Location"}
                          </span>
                          {warning.supportedLocationName && (
                            <>
                              <ChevronRight className="h-3 w-3 opacity-50 mx-0.5" />
                              <span className="text-amber-600 dark:text-amber-500 font-medium">
                                Allowed: {warning.supportedLocationName}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs mb-2">
                          {warning.eligibleForRemoval ? (
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                              Eligible for removal
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                              Ineligible for removal
                            </Badge>
                          )}
                          <div className="bg-background rounded px-2 py-0.5 border shadow-sm flex items-center gap-1.5">
                            <span className="text-muted-foreground font-medium">Qty:</span>
                            <span className="font-mono">{warning.qty || '0'}</span>
                          </div>
                          {warning.caseQty != null && (
                            <div className="bg-background rounded px-2 py-0.5 border shadow-sm flex items-center gap-1.5">
                              <span className="text-muted-foreground font-medium">Cases:</span>
                              <span className="font-mono">{warning.caseQty}</span>
                            </div>
                          )}
                          {warning.containerQty != null && (
                            <div className="bg-background rounded px-2 py-0.5 border shadow-sm flex items-center gap-1.5">
                              <span className="text-muted-foreground font-medium">Containers:</span>
                              <span className="font-mono">{warning.containerQty}</span>
                            </div>
                          )}
                          {warning.looseUnits != null && (
                            <div className="bg-background rounded px-2 py-0.5 border shadow-sm flex items-center gap-1.5">
                              <span className="text-muted-foreground font-medium">Loose:</span>
                              <span className="font-mono">{warning.looseUnits}</span>
                            </div>
                          )}
                          <div className="bg-background rounded px-2 py-0.5 border shadow-sm flex items-center gap-1.5 text-muted-foreground">
                            <span>{warning.entryCount} {warning.entryCount === 1 ? 'entry' : 'entries'}</span>
                          </div>
                        </div>

                        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded p-1.5 inline-block">
                          {warning.reason}
                        </p>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 h-8 text-xs font-medium"
                        onClick={() => handleLineClick(warning.lineId, warning.itemId, warning.currentLocationName)}
                        title="View line in count session"
                      >
                        View line <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </>
      ) : null}
    </div>
  );

  const eligibleCount = data?.warnings?.filter(w => w.eligibleForRemoval).length || 0;

  const footer = (
    <div className="flex flex-col sm:flex-row gap-2 w-full pt-2">
      <Button variant="outline" onClick={() => onOpenChange(false)} className="sm:ml-auto">
        Close
      </Button>
      {data?.canRemove && eligibleCount > 0 && (
        <Button
          variant="destructive"
          onClick={() => setShowConfirm(true)}
        >
          Remove {eligibleCount} unsupported {eligibleCount === 1 ? "line" : "lines"}
        </Button>
      )}
    </div>
  );

  const TitleAndDesc = () => (
    <>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        <span>Location Review</span>
      </div>
      <p className="text-sm text-muted-foreground font-normal mt-1.5">
        Review items with prior counting history that could not be safely matched to a location in your current configuration.
      </p>
    </>
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[85vh] flex flex-col pt-4 px-4 sm:px-6">
            <SheetHeader className="text-left flex-none space-y-0 pb-2 border-b">
              <SheetTitle className="text-lg">
                <TitleAndDesc />
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0">
              {content}
            </div>
            <SheetFooter className="flex-none pt-4 border-t mt-auto mb-safe">
              {footer}
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
            <DialogHeader className="flex-none">
              <DialogTitle className="text-xl">
                <TitleAndDesc />
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-hidden">
              {content}
            </div>
            <DialogFooter className="flex-none pt-4">
              {footer}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove two unsupported lines?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the two unsupported Main freezer assignments and remove only their untouched zero-count August lines. The supported lines and July history stay in place. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resolveMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleResolve();
              }}
              disabled={resolveMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resolveMutation.isPending ? "Removing..." : "Yes, remove lines"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
