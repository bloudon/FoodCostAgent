import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  CheckCircle2,
  ArrowRight,
  ChevronRight,
} from "lucide-react";

interface Milestone {
  id: string;
  label: string;
  completed: boolean;
  path: string;
}

interface MilestonesResponse {
  milestones: Milestone[];
  completedCount: number;
  totalCount: number;
  dismissed: boolean;
}

const milestoneLabels: Record<string, string> = {
  store: "Store",
  categories: "Review Categories",
  vendors: "Vendor",
  inventory: "Inventory",
  recipes: "Recipe",
  menu: "Menu Items",
};

interface SetupProgressBannerProps {
  currentMilestoneId: string;
  hasEntries?: boolean;
}

export function SetupProgressBanner({ currentMilestoneId, hasEntries = false }: SetupProgressBannerProps) {
  const { data, isLoading } = useQuery<MilestonesResponse>({
    queryKey: ["/api/onboarding/milestones"],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const reviewStepMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/onboarding/milestones/review-step", { stepId: currentMilestoneId });
      if (!response.ok) throw new Error("Failed to complete step");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
    },
  });

  if (isLoading || !data || data.dismissed) return null;
  if (data.completedCount === data.totalCount) return null;

  const currentMilestone = data.milestones.find((m) => m.id === currentMilestoneId);
  const currentIndex = data.milestones.findIndex((m) => m.id === currentMilestoneId);
  if (currentIndex < 0) return null;
  const nextMilestone = data.milestones.find((m, i) => i > currentIndex && !m.completed);
  const currentCompleted = currentMilestone?.completed;

  const handleDoneNextStep = () => {
    reviewStepMutation.mutate();
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      data-testid="setup-progress-banner"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 max-w-screen-xl mx-auto">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {currentCompleted ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium hidden sm:inline">
                {milestoneLabels[currentMilestoneId] || currentMilestone?.label} done!
              </span>
              <span className="text-sm font-medium sm:hidden">
                Done!
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              Step {currentIndex + 1} of {data.totalCount}
            </span>
          )}
          {nextMilestone && currentCompleted && (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
          )}
          {nextMilestone && currentCompleted && (
            <span className="text-sm text-muted-foreground truncate">
              Next: {nextMilestone.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {nextMilestone && currentCompleted && (
            <Link href={nextMilestone.path}>
              <Button size="sm" data-testid="button-next-milestone">
                Continue
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          )}
          {nextMilestone && !currentCompleted && hasEntries && (
            <Button
              size="sm"
              onClick={handleDoneNextStep}
              disabled={reviewStepMutation.isPending}
              data-testid="button-done-next-step"
            >
              {reviewStepMutation.isPending ? "Saving..." : "Done, Next Step"}
              {!reviewStepMutation.isPending && <ArrowRight className="h-3.5 w-3.5 ml-1" />}
            </Button>
          )}
          {nextMilestone && !currentCompleted && (
            <Link href={nextMilestone.path}>
              <Button variant="outline" size="sm" data-testid="button-skip-milestone">
                Skip
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
