import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { useCompany } from "@/hooks/use-company";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  X,
  Lightbulb,
  Store,
  Loader2,
} from "lucide-react";
import { Link, useLocation } from "wouter";

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
  const { refreshAuth, user } = useAuth();
  const { company } = useCompany();
  const [, navigate] = useLocation();
  const defaultStoreName = company?.name ? `${company.name}'s Store` : "";
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [storeName, setStoreName] = useState(defaultStoreName);
  const [storeCode, setStoreCode] = useState("S001");
  const [managerEmail, setManagerEmail] = useState("");
  const hasAutoExpandedStore = useRef(false);

  useEffect(() => {
    if (company?.name && !storeName) {
      setStoreName(`${company.name}'s Store`);
    }
  }, [company?.name]);

  const { data, isLoading, isError } = useQuery<MilestonesResponse>({
    queryKey: ["/api/onboarding/milestones"],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (data && !data.dismissed && !hasAutoExpandedStore.current) {
      const storeMilestone = data.milestones.find((m) => m.id === "store");
      if (storeMilestone && !storeMilestone.completed) {
        setShowStoreForm(true);
        hasAutoExpandedStore.current = true;
      }
    }
  }, [data]);

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

  const createStoreMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/onboarding/store", {
        name: storeName,
        code: storeCode,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Failed to create store" }));
        throw new Error(errorData.error || errorData.message || "Failed to create store");
      }
      return response.json();
    },
    onSuccess: async (result: any) => {
      await refreshAuth();
      setShowStoreForm(false);
      setStoreName(defaultStoreName);
      setStoreCode("S001");

      const emailToInvite = managerEmail.trim();
      setManagerEmail("");

      if (emailToInvite && result?.store?.id) {
        apiRequest("POST", "/api/invitations", {
          email: emailToInvite,
          role: "store_manager",
          storeIds: [result.store.id],
        }).catch(() => {});
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/onboarding/milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stores/accessible"] });
      const nextStep = data?.milestones.find((m) => m.id !== "store" && !m.completed);
      if (nextStep) {
        navigate(nextStep.path);
      }
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
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
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
  const storeMilestone = data.milestones.find((m) => m.id === "store");
  const storeNotCreated = storeMilestone && !storeMilestone.completed;

  return (
    <div className="mb-6" data-testid="milestone-tracker">
      <Card className="border-accent/30 bg-gradient-to-r from-accent/5 to-transparent">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <button
              className="flex items-center gap-3 cursor-pointer bg-transparent border-0 p-0"
              onClick={() => setIsCollapsed(!isCollapsed)}
              data-testid="button-toggle-tracker"
            >
              <CardTitle className="text-base" data-testid="milestone-tracker-title">
                Getting Started
              </CardTitle>
              <span
                className="text-sm font-medium text-muted-foreground"
                data-testid="milestone-tracker-progress-text"
              >
                {data.completedCount}/{data.totalCount} Complete
              </span>
              {isCollapsed ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
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
          <Progress
            value={progressPercent}
            className="mt-2 h-1.5"
            data-testid="milestone-tracker-progress-bar"
          />
          {!isCollapsed && data.completedCount > 0 && data.completedCount < data.totalCount && (
            <p className="text-xs text-muted-foreground mt-2" data-testid="milestone-encouragement">
              Great progress! Keep going to get the most out of FNB Cost Pro.
            </p>
          )}
        </CardHeader>

        {!isCollapsed && (
          <CardContent className="pt-0 pb-4">
            <div className="space-y-1" data-testid="milestone-list">
              {data.milestones.map((milestone) => (
                <div key={milestone.id}>
                  <div
                    className="flex items-center justify-between gap-3 py-1.5 px-1 rounded-md"
                    data-testid={`milestone-row-${milestone.id}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {milestone.completed ? (
                        <CheckCircle2
                          className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0"
                          data-testid={`milestone-check-${milestone.id}`}
                        />
                      ) : (
                        <Circle
                          className="h-4 w-4 text-muted-foreground/50 shrink-0"
                          data-testid={`milestone-circle-${milestone.id}`}
                        />
                      )}
                      <span
                        className={`text-sm truncate ${
                          milestone.completed ? "line-through text-muted-foreground" : ""
                        }`}
                        data-testid={`milestone-label-${milestone.id}`}
                      >
                        {milestone.label}
                      </span>
                    </div>
                    {!milestone.completed && (
                      <>
                        {milestone.id === "store" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowStoreForm(!showStoreForm)}
                            data-testid="button-go-store"
                          >
                            {showStoreForm ? "Cancel" : "Set Up"}
                            {!showStoreForm && <ArrowRight className="h-3 w-3 ml-1" />}
                          </Button>
                        ) : (
                          <Link href={milestone.path}>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid={`button-go-${milestone.id}`}
                            >
                              Go
                              <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                          </Link>
                        )}
                      </>
                    )}
                  </div>

                  {milestone.id === "store" && showStoreForm && storeNotCreated && (
                    <div
                      className="ml-7 mt-1 mb-2 p-3 rounded-md bg-muted/50 space-y-3"
                      data-testid="inline-store-form"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Store className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Name Your First Store</span>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">
                            Store Name *
                          </label>
                          <Input
                            placeholder="e.g. Downtown Location"
                            value={storeName}
                            onChange={(e) => setStoreName(e.target.value)}
                            autoFocus
                            data-testid="input-store-name"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">
                            Store Code *
                          </label>
                          <Input
                            placeholder="S001"
                            value={storeCode}
                            onChange={(e) => setStoreCode(e.target.value)}
                            data-testid="input-store-code"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">
                            Store Manager Email <span className="opacity-60">(optional)</span>
                          </label>
                          <Input
                            type="email"
                            placeholder="manager@example.com"
                            value={managerEmail}
                            onChange={(e) => setManagerEmail(e.target.value)}
                            data-testid="input-store-manager-email"
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            We'll send them an invitation to set up their account.
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={
                          !storeName.trim() ||
                          !storeCode.trim() ||
                          createStoreMutation.isPending
                        }
                        onClick={() => createStoreMutation.mutate()}
                        data-testid="button-save-store"
                      >
                        {createStoreMutation.isPending ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          "Create Store"
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
