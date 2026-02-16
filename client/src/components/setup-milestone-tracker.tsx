import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Circle, ArrowRight, X, Lightbulb } from "lucide-react";
import { Link } from "wouter";

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

export function SetupMilestoneTracker() {
  const { data, isLoading, isError } = useQuery<MilestonesResponse>({
    queryKey: ["/api/onboarding/milestones"],
    retry: false,
  });

  const dismissMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/onboarding/milestones/dismiss"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
    },
  });

  const undismissMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/onboarding/milestones/undismiss");
      if (!response.ok) throw new Error("Failed to restore setup guide");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
    },
  });

  if (isLoading) {
    return (
      <div className="mb-6" data-testid="milestone-tracker-loading">
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-2 w-full mb-4" />
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return null;
  }

  if (data.dismissed && data.completedCount < data.totalCount) {
    return (
      <div className="mb-4 flex items-center justify-between gap-2 px-1 py-2" data-testid="setup-guide-recall">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lightbulb className="h-4 w-4" />
          <span>Need help finishing setup?</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => undismissMutation.mutate()}
          disabled={undismissMutation.isPending}
          data-testid="button-reopen-setup-guide"
        >
          Reopen Setup Guide
        </Button>
      </div>
    );
  }

  if (data.dismissed || data.completedCount === data.totalCount) {
    return null;
  }

  const progressPercent = (data.completedCount / data.totalCount) * 100;

  return (
    <div className="mb-6" data-testid="milestone-tracker">
      <Card className="border-accent/30 bg-gradient-to-r from-accent/5 to-transparent">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base" data-testid="milestone-tracker-title">Getting Started</CardTitle>
              <span className="text-sm text-muted-foreground" data-testid="milestone-tracker-progress-text">
                {data.completedCount} of {data.totalCount} complete
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => dismissMutation.mutate()}
              disabled={dismissMutation.isPending}
              aria-label="Dismiss setup tracker"
              data-testid="button-dismiss-milestones"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Progress value={progressPercent} className="mt-2 h-1.5" data-testid="milestone-tracker-progress-bar" />
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <div className="space-y-1" data-testid="milestone-list">
            {data.milestones.map((milestone) => (
              <div
                key={milestone.id}
                className="flex items-center justify-between gap-3 py-1.5 px-1 rounded-md"
                data-testid={`milestone-row-${milestone.id}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {milestone.completed ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" data-testid={`milestone-check-${milestone.id}`} />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground/50 shrink-0" data-testid={`milestone-circle-${milestone.id}`} />
                  )}
                  <span
                    className={`text-sm truncate ${milestone.completed ? "line-through text-muted-foreground" : ""}`}
                    data-testid={`milestone-label-${milestone.id}`}
                  >
                    {milestone.label}
                  </span>
                </div>
                {!milestone.completed && (
                  <Link href={milestone.path}>
                    <Button variant="ghost" size="sm" data-testid={`button-go-${milestone.id}`}>
                      Go
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
