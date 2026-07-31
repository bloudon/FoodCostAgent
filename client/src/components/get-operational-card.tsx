/**
 * GetOperationalCard — full-width "Get Operational" checklist shown at the
 * top of the dashboard when a new company hasn't finished basic setup yet.
 *
 * Shows 4 required steps + 1 optional step:
 *   1. Scan your menu          (required)
 *   2. Set up store & storage  (required)
 *   3. Upload a vendor invoice  (required)
 *   4. Import Orderly data      (required)
 *   5. Run your first inventory count  (optional — don't count before you
 *      know what you're counting; users can do this later)
 *
 * Step completion is driven by the onboarding milestones API (steps 1-3, 5)
 * and the Orderly batches API (step 4).
 * Dismiss state is shared with SetupMilestoneTracker via the milestones API.
 * The card auto-hides when all REQUIRED steps are complete.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import {
  CheckCircle2,
  ArrowRight,
  X,
  Rocket,
  UtensilsCrossed,
  Building2,
  FileText,
  Package,
  ClipboardList,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface MilestonesResponse {
  milestones: { id: string; label: string; completed: boolean; path: string }[];
  completedCount: number;
  totalCount: number;
  dismissed: boolean;
}

// ── Step definitions ───────────────────────────────────────────────────────

interface OperationalStep {
  id: string;
  /** Onboarding milestone ID to check for completion, or null for custom logic */
  milestoneId: string | null;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  href: string;
  /** Optional steps don't block card dismissal — card hides when all required steps are done. */
  optional?: boolean;
}

const STEPS: OperationalStep[] = [
  {
    id: "menu",
    milestoneId: "menu_scan",
    label: "Scan your menu",
    description: "Import your dishes and prices from a menu photo",
    Icon: UtensilsCrossed,
    href: "/menu-scan?mode=menu",
  },
  {
    id: "storage",
    milestoneId: "storage_locations",
    label: "Set up store & storage areas",
    description: "Define your walk-in, dry storage, and other count locations",
    Icon: Building2,
    href: "/onboarding",
  },
  {
    id: "invoice",
    milestoneId: "invoice_scan",
    label: "Upload a vendor invoice",
    description: "Scan an invoice to seed your vendor and ingredient data",
    Icon: FileText,
    href: "/onboarding",
  },
  {
    id: "orderly",
    milestoneId: null, // completion driven by orderly batches API
    label: "Import Orderly inventory data",
    description: "Pull in historical count sessions from Orderly",
    Icon: Package,
    href: "/orderly-import",
  },
  {
    id: "count",
    milestoneId: "inventory_count",
    label: "Run your first inventory count",
    description: "Count current stock to establish your baseline",
    Icon: ClipboardList,
    href: "/inventory-sessions",
    // Optional: don't count before you know what you're counting.
    // Card auto-hides when the 4 required steps above are complete.
    optional: true,
  },
];

// ── Component ──────────────────────────────────────────────────────────────

export function GetOperationalCard() {
  const { data: milestonesData, isLoading: milestonesLoading } =
    useQuery<MilestonesResponse>({
      queryKey: ["/api/onboarding/milestones"],
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    });

  const { data: orderlyBatches = [] } = useQuery<any[]>({
    queryKey: ["/api/inventory-import/orderly/batches"],
    retry: false,
    staleTime: 30_000,
  });

  const dismissMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/onboarding/milestones/dismiss"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
    },
  });

  // ── Guard conditions ──────────────────────────────────────────────────────

  if (milestonesLoading || !milestonesData) return null;
  // Shared dismiss flag with SetupMilestoneTracker
  if (milestonesData.dismissed) return null;
  // Optimistic hide: if the server already reports all milestones complete AND
  // the orderly step (tracked separately on the client) is also done, the next
  // GET will auto-dismiss.  Hiding here prevents a brief flash of the card
  // while the refetch is in-flight (stale cached data may still carry
  // dismissed: false even though the server is about to flip it to true).
  const orderlyAlreadyDone = (orderlyBatches as any[]).length > 0;
  if (milestonesData.completedCount === milestonesData.totalCount && orderlyAlreadyDone) return null;

  // ── Build per-step completion ─────────────────────────────────────────────

  const milestoneMap = new Map(
    milestonesData.milestones.map((m) => [m.id, m.completed])
  );

  const stepsWithStatus = STEPS.map((step) => {
    let done: boolean;
    if (step.id === "orderly") {
      done = (orderlyBatches as any[]).length > 0;
    } else if (step.milestoneId) {
      done = milestoneMap.get(step.milestoneId) ?? false;
    } else {
      done = false;
    }
    return { ...step, done };
  });

  // Required steps drive progress, auto-hide, and the "Next" / "Continue" flow.
  // Optional steps are shown at the bottom but don't block card dismissal.
  const requiredSteps = stepsWithStatus.filter((s) => !s.optional);
  const requiredCompleted = requiredSteps.filter((s) => s.done).length;

  // Auto-hide once all required steps are done (optional step doesn't block).
  if (requiredCompleted === requiredSteps.length) return null;

  const nextStep = requiredSteps.find((s) => !s.done);
  const progressPct = (requiredCompleted / requiredSteps.length) * 100;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mb-6" data-testid="get-operational-card">
      <Card className="border-[#f2690d]/30 bg-gradient-to-r from-[#f2690d]/5 to-transparent">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Rocket className="h-4 w-4 text-[#f2690d] shrink-0" />
              <span className="font-semibold text-base">Get Operational</span>
              <span
                className="text-sm text-muted-foreground shrink-0"
                data-testid="operational-card-progress-text"
              >
                {requiredCompleted} of {requiredSteps.length} complete
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => dismissMutation.mutate()}
              disabled={dismissMutation.isPending}
              aria-label="Dismiss setup card"
              data-testid="button-dismiss-operational-card"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Progress
            value={progressPct}
            className="mt-2 h-1.5"
            data-testid="operational-card-progress-bar"
          />
        </CardHeader>

        <CardContent className="pt-0 pb-4">
          <div className="space-y-0.5" data-testid="operational-step-list">
            {stepsWithStatus.map((step) => {
              const { Icon } = step;
              const isNext = step.id === nextStep?.id;
              const isOptional = !!step.optional;

              return (
                <div
                  key={step.id}
                  className={`flex items-center justify-between gap-3 py-2 px-2 rounded-md transition-colors ${
                    isNext && !step.done ? "bg-[#f2690d]/10" : ""
                  }`}
                  data-testid={`operational-step-${step.id}`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {step.done ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400 shrink-0 mt-0.5" />
                    ) : (
                      <Icon
                        className={`h-4 w-4 shrink-0 mt-0.5 ${
                          isNext
                            ? "text-[#f2690d]"
                            : "text-muted-foreground/40"
                        }`}
                      />
                    )}
                    <div className="min-w-0">
                      <p
                        className={`text-sm leading-snug ${
                          step.done
                            ? "line-through text-muted-foreground"
                            : isNext
                            ? "font-medium"
                            : "text-muted-foreground"
                        }`}
                        data-testid={`operational-step-label-${step.id}`}
                      >
                        {step.label}
                        {isNext && !step.done && (
                          <span className="ml-2 text-[10px] font-semibold text-[#f2690d] uppercase tracking-wide align-middle">
                            Next
                          </span>
                        )}
                        {isOptional && !step.done && !isNext && (
                          <span className="ml-2 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide align-middle">
                            Optional
                          </span>
                        )}
                      </p>
                      {isNext && !step.done && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {isNext && !step.done && (
                    <Link href={step.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        data-testid={`button-go-operational-${step.id}`}
                      >
                        Go
                        <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                  {isOptional && !step.done && !isNext && (
                    <Link href={step.href}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground/60"
                        data-testid={`button-go-operational-${step.id}`}
                      >
                        Go
                        <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>

          {nextStep && (
            <div className="mt-4 pt-3 border-t">
              <Link href={nextStep.href}>
                <Button
                  className="w-full text-white"
                  style={{ backgroundColor: "#f2690d", borderColor: "#f2690d" }}
                  data-testid="button-continue-operational"
                >
                  Continue: {nextStep.label}
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
