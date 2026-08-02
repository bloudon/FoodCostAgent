import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Copy,
  Merge,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  PackageSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDateString } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DuplicateItem {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unitId: string;
  pricePerUnit: number;
  avgCostPerUnit: number;
  active: number;
  updatedAt: string;
}

interface DuplicateGroup {
  normalizedName: string;
  itemCount: number;
  items: DuplicateItem[];
}

interface MergeResult {
  primaryItemId: string;
  mergedCount: number;
  vendorItemsReassigned: number;
  storeAssignmentsMerged: number;
  countLinesMerged: number;
  recipeComponentsReassigned: number;
  locationAssignmentsMerged: number;
}

// ---------------------------------------------------------------------------
// DuplicateGroupCard
// ---------------------------------------------------------------------------

function DuplicateGroupCard({
  group,
  onMerge,
  isMerging,
  merged,
}: {
  group: DuplicateGroup;
  onMerge: (primaryId: string, dupeIds: string[]) => void;
  isMerging: boolean;
  merged: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [primaryId, setPrimaryId] = useState<string>(group.items[0].id);

  if (merged) {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20">
        <CardContent className="py-3 px-4 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            <strong>{group.items[0].name}</strong> group merged successfully.
          </span>
        </CardContent>
      </Card>
    );
  }

  const dupeIds = group.items.map((i) => i.id).filter((id) => id !== primaryId);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <button
            className="flex items-center gap-2 text-left flex-1 min-w-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold truncate">
                {group.items[0].name}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {group.itemCount} duplicates · normalized: &ldquo;{group.normalizedName}&rdquo;
              </p>
            </div>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary">{group.itemCount} items</Badge>
            <Button
              size="sm"
              variant="default"
              disabled={isMerging}
              onClick={() => onMerge(primaryId, dupeIds)}
              data-testid={`button-merge-group-${group.normalizedName.slice(0, 20)}`}
            >
              {isMerging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Merge className="h-3.5 w-3.5 mr-1.5" />
              )}
              Merge
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 pb-3 px-4">
          <p className="text-xs text-muted-foreground mb-3">
            Select the <strong>primary item</strong> to keep. All vendor links, count
            history, and recipe references from the other items will be reassigned to it, then the
            duplicates will be deleted.
          </p>
          <RadioGroup
            value={primaryId}
            onValueChange={setPrimaryId}
            className="space-y-2"
          >
            {group.items.map((item) => (
              <div
                key={item.id}
                className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${
                  item.id === primaryId
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <RadioGroupItem
                  value={item.id}
                  id={`radio-${item.id}`}
                  className="mt-0.5 shrink-0"
                />
                <Label
                  htmlFor={`radio-${item.id}`}
                  className="flex-1 cursor-pointer space-y-0.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{item.name}</span>
                    {item.id === primaryId && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-primary border-primary/50">
                        Keep
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {item.categoryName && (
                      <span>Category: {item.categoryName}</span>
                    )}
                    <span>Unit: {item.unitId}</span>
                    <span>
                      Last updated:{" "}
                      {item.updatedAt ? formatDateString(item.updatedAt) : "—"}
                    </span>
                    <span>
                      Cost: ${item.avgCostPerUnit > 0 ? item.avgCostPerUnit.toFixed(4) : item.pricePerUnit.toFixed(4)}
                    </span>
                  </div>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InventoryItemsDedup() {
  const { toast } = useToast();
  const [mergedGroupKeys, setMergedGroupKeys] = useState<Set<string>>(new Set());
  const [mergingGroupKey, setMergingGroupKey] = useState<string | null>(null);

  const { data: groups = [], isLoading, error, refetch } = useQuery<DuplicateGroup[]>({
    queryKey: ["/api/inventory-items/duplicates"],
  });

  const mergeMutation = useMutation({
    mutationFn: async ({
      primaryItemId,
      duplicateItemIds,
    }: {
      primaryItemId: string;
      duplicateItemIds: string[];
      groupKey: string;
    }) => {
      const res = await apiRequest("POST", "/api/inventory-items/merge", {
        primaryItemId,
        duplicateItemIds,
      });
      return (await res.json()) as MergeResult;
    },
    onSuccess: (result, variables) => {
      setMergedGroupKeys((prev) => new Set(Array.from(prev).concat(variables.groupKey)));
      setMergingGroupKey(null);
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-items"] });
      toast({
        title: "Merge complete",
        description: `${result.mergedCount} duplicate(s) merged into primary item. Vendor links, count lines, and recipe references updated.`,
      });
    },
    onError: (error: Error, variables) => {
      setMergingGroupKey(null);
      toast({
        title: "Merge failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function handleMerge(
    group: DuplicateGroup,
    primaryId: string,
    dupeIds: string[]
  ) {
    const groupKey = group.normalizedName;
    setMergingGroupKey(groupKey);
    mergeMutation.mutate({
      primaryItemId: primaryId,
      duplicateItemIds: dupeIds,
      groupKey,
    });
  }

  const pendingGroups = groups.filter((g) => !mergedGroupKeys.has(g.normalizedName));
  const doneGroups = groups.filter((g) => mergedGroupKeys.has(g.normalizedName));

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-background border-b px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-1">
          <Button asChild variant="ghost" size="sm" className="h-7 px-2">
            <Link href="/inventory-items">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Items
            </Link>
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Copy className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold">Find Duplicates</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Items with the same normalized name are grouped below. Select a primary item per
              group, then merge to consolidate.
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Scanning for duplicates…</span>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Failed to load duplicates</AlertTitle>
            <AlertDescription>
              {(error as Error).message}
              <button
                className="pl-1 text-sm underline"
                onClick={() => refetch()}
              >
                Retry
              </button>
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && groups.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-20 gap-3 text-center"
            data-testid="dedup-empty-state"
          >
            <PackageSearch className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-base font-medium">No duplicates found</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              All active inventory items have unique normalized names. Your catalog is clean!
            </p>
          </div>
        )}

        {!isLoading && !error && groups.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {pendingGroups.length > 0
                  ? `${pendingGroups.length} duplicate group${pendingGroups.length !== 1 ? "s" : ""} found`
                  : "All groups merged — catalog is clean!"}
              </p>
              <p className="text-xs text-muted-foreground">
                {groups.reduce((sum, g) => sum + g.itemCount, 0)} items across{" "}
                {groups.length} groups
              </p>
            </div>

            {/* Pending groups */}
            {pendingGroups.map((group) => (
              <DuplicateGroupCard
                key={group.normalizedName}
                group={group}
                merged={false}
                isMerging={mergingGroupKey === group.normalizedName}
                onMerge={(primaryId, dupeIds) =>
                  handleMerge(group, primaryId, dupeIds)
                }
              />
            ))}

            {/* Merged groups (collapsed success state) */}
            {doneGroups.map((group) => (
              <DuplicateGroupCard
                key={group.normalizedName}
                group={group}
                merged
                isMerging={false}
                onMerge={() => {}}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
