import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Calendar as CalendarIcon, Star, ClipboardList } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import { useTier } from "@/hooks/use-tier";

export default function NewCountSession() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { hasFeature } = useTier();
  const canUsePowerInventory = hasFeature("power_inventory");

  const [storeId, setStoreId] = useState("");
  const [countDate, setCountDate] = useState<Date>(new Date());
  const [note, setNote] = useState("");
  const [isPowerSession, setIsPowerSession] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const companyId =
    user?.role === "global_admin"
      ? localStorage.getItem("selectedCompanyId")
      : user?.companyId;

  const { data: stores = [] } = useAccessibleStores();

  // Auto-select when there's only one store
  const resolvedStoreId = storeId || (stores.length === 1 ? stores[0].id : "");

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No company selected");
      if (!resolvedStoreId) throw new Error("Please select a store location");

      const year = countDate.getFullYear();
      const month = String(countDate.getMonth() + 1).padStart(2, "0");
      const day = String(countDate.getDate()).padStart(2, "0");
      const countDateStr = `${year}-${month}-${day}`;

      const response = await apiRequest("POST", "/api/inventory-counts", {
        userId: "system",
        companyId,
        storeId: resolvedStoreId,
        countDate: countDateStr,
        note: note || undefined,
        isPowerSession: isPowerSession ? 1 : 0,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-counts"] });
      setLocation(`/count/${data.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create session",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/inventory-sessions");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-background sticky top-0 z-10">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          data-testid="button-back-new-count"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">New Inventory Count</h1>
      </div>

      <div className="p-4 max-w-lg mx-auto space-y-4 pt-6">
        {/* Icon + intro */}
        <div className="flex items-center gap-3 mb-2">
          <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
            <ClipboardList className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="font-medium">Start a fresh count</p>
            <p className="text-sm text-muted-foreground">Fill in the details below to begin</p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-5 space-y-5">
            {/* Store selector */}
            <div className="space-y-1.5">
              <Label htmlFor="store-select">Store Location *</Label>
              {stores.length === 1 ? (
                <div className="px-3 py-2 rounded-md border bg-muted/40 text-sm">
                  {stores[0].name}
                </div>
              ) : (
                <Select
                  value={resolvedStoreId}
                  onValueChange={setStoreId}
                >
                  <SelectTrigger id="store-select" data-testid="select-store-new-count">
                    <SelectValue placeholder="Select a store..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store: any) => (
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
            </div>

            {/* Date picker */}
            <div className="space-y-1.5">
              <Label>Inventory Date</Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !countDate && "text-muted-foreground"
                    )}
                    data-testid="button-date-picker-new-count"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {countDate ? format(countDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={countDate}
                    onSelect={(date) => {
                      if (date) {
                        setCountDate(date);
                        setDatePickerOpen(false);
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <Label htmlFor="count-note">Note (Optional)</Label>
              <Input
                id="count-note"
                placeholder="e.g. Monthly count, end of quarter..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="input-note-new-count"
              />
            </div>

            {/* Power Count toggle */}
            {canUsePowerInventory && (
              <div className="flex items-start gap-3 pt-2 border-t">
                <Checkbox
                  id="power-session"
                  checked={isPowerSession}
                  onCheckedChange={(checked) => setIsPowerSession(checked === true)}
                  className="mt-0.5"
                  data-testid="checkbox-power-new-count"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="power-session" className="cursor-pointer font-medium flex items-center gap-1.5">
                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-400" />
                    Power Inventory Count
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Only count high-cost power items for faster, focused tracking
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col gap-3 pt-2">
          <Button
            className="w-full"
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending || !resolvedStoreId}
            data-testid="button-create-new-count"
          >
            {createSessionMutation.isPending ? "Creating..." : "Start Count Session"}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleBack}
            data-testid="button-cancel-new-count"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
