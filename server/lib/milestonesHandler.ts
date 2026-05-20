import type { Request, Response } from "express";

export interface OnboardingProgressRecord {
  stepData: string | null;
  isCompleted?: number | null;
}

export interface ReviewStepDeps {
  getProgress: (companyId: string) => Promise<OnboardingProgressRecord | null>;
  upsertProgress: (companyId: string, stepData: string) => Promise<void>;
}

export function createReviewStepHandler(deps: ReviewStepDeps) {
  return async (req: Request, res: Response) => {
    try {
      const companyId: string | undefined = (req as any).user?.companyId;
      if (!companyId) {
        return res.status(400).json({ error: "User is not associated with a company" });
      }

      const stepId: unknown = (req.body as any)?.stepId;
      if (!stepId || typeof stepId !== "string" || stepId.trim() === "") {
        return res.status(400).json({ error: "stepId is required" });
      }

      const existing = await deps.getProgress(companyId);

      let reviewedSteps: string[] = [];
      if (existing?.stepData) {
        try {
          const parsed = JSON.parse(existing.stepData) as { reviewedSteps?: string[] };
          reviewedSteps = parsed.reviewedSteps ?? [];
        } catch {
          // malformed JSON — treat as empty
        }
      }

      if (!reviewedSteps.includes(stepId)) {
        reviewedSteps.push(stepId);
      }

      await deps.upsertProgress(companyId, JSON.stringify({ reviewedSteps }));

      return res.json({ success: true });
    } catch (error: any) {
      console.error("Review step error:", error);
      return res.status(500).json({ error: "Failed to mark step as reviewed" });
    }
  };
}

export interface MilestoneDataPresence {
  hasMenuItems: boolean;
  hasPlan: boolean;
  hasInventoryItems: boolean;
  hasStorageLocations: boolean;
  hasRecipes: boolean;
  hasInventoryCount: boolean;
  hasMenuInsightsData: boolean;
}

export interface GetMilestonesDeps {
  getProgress: (companyId: string) => Promise<OnboardingProgressRecord | null>;
  getDataPresence: (companyId: string) => Promise<MilestoneDataPresence>;
  /** Called when all milestones complete to auto-dismiss (set isCompleted = 1). */
  markCompleted: (companyId: string) => Promise<void>;
}

export interface MilestoneEntry {
  id: string;
  label: string;
  completed: boolean;
  path: string;
}

export interface MilestonesResponse {
  milestones: MilestoneEntry[];
  completedCount: number;
  totalCount: number;
  dismissed: boolean;
}

export function computeMilestones(
  reviewedSteps: string[],
  data: MilestoneDataPresence,
): MilestoneEntry[] {
  const milestones: MilestoneEntry[] = [
    {
      id: "menu_scan",
      label: "Scan Your Menu",
      completed: data.hasMenuItems || reviewedSteps.includes("menu_scan"),
      path: "/onboarding/setup",
    },
    {
      id: "plan",
      label: "Choose a Plan",
      completed: data.hasPlan || reviewedSteps.includes("plan"),
      path: "/onboarding/setup",
    },
    {
      id: "invoice_scan",
      label: "Scan an Invoice",
      completed: data.hasInventoryItems || reviewedSteps.includes("invoice_scan"),
      path: "/onboarding/setup",
    },
    {
      id: "categories",
      label: "Review Categories",
      // No data fallback — only review-step can complete this milestone.
      completed: reviewedSteps.includes("categories"),
      path: "/onboarding/setup",
    },
    {
      id: "storage_locations",
      label: "Set Up Storage",
      completed: data.hasStorageLocations || reviewedSteps.includes("storage_locations"),
      path: "/onboarding/setup",
    },
    {
      id: "recipes",
      label: "Build Recipes",
      completed: data.hasRecipes || reviewedSteps.includes("recipes"),
      path: "/onboarding/setup",
    },
    {
      id: "review",
      label: "Review Setup",
      // No data fallback — only review-step can complete this milestone.
      completed: reviewedSteps.includes("review"),
      path: "/onboarding/setup",
    },
    {
      id: "inventory_count",
      label: "First Count",
      completed: data.hasInventoryCount || reviewedSteps.includes("inventory_count"),
      path: "/onboarding/setup",
    },
  ];

  if (data.hasMenuInsightsData) {
    milestones.push({
      id: "menu_insights",
      label: "View Menu Insights",
      completed: reviewedSteps.includes("menu_insights"),
      path: "/menu-insights",
    });
  }

  return milestones;
}

export function createGetMilestonesHandler(deps: GetMilestonesDeps) {
  return async (req: Request, res: Response) => {
    try {
      const companyId: string | undefined = (req as any).user?.companyId;
      if (!companyId) {
        return res.status(400).json({ error: "User is not associated with a company" });
      }

      const [progressRow, dataPresence] = await Promise.all([
        deps.getProgress(companyId),
        deps.getDataPresence(companyId),
      ]);

      const reviewedSteps = parseReviewedSteps(progressRow?.stepData);
      const milestones = computeMilestones(reviewedSteps, dataPresence);
      const completedCount = milestones.filter((m) => m.completed).length;
      const totalCount = milestones.length;
      const allComplete = completedCount === totalCount;

      let dismissed = (progressRow?.isCompleted ?? 0) === 1;

      if (allComplete && !dismissed) {
        await deps.markCompleted(companyId);
        dismissed = true;
      }

      return res.json({ milestones, completedCount, totalCount, dismissed });
    } catch (error: any) {
      console.error("Milestones fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch milestones" });
    }
  };
}

/** Milestones that can only be completed via review-step (no data fallback). */
export const REVIEW_ONLY_MILESTONES = new Set(["categories", "review"]);

/** Returns true if the milestone is completed via reviewed steps or existing data. */
export function isMilestoneCompleted(
  id: string,
  reviewedSteps: string[],
  hasData: boolean,
): boolean {
  return reviewedSteps.includes(id) || hasData;
}

/** Parses the reviewedSteps list from a stepData JSON string. Returns [] on missing/invalid input. */
export function parseReviewedSteps(stepData: string | null | undefined): string[] {
  if (!stepData) return [];
  try {
    const parsed = JSON.parse(stepData) as { reviewedSteps?: unknown };
    if (Array.isArray(parsed.reviewedSteps)) {
      return parsed.reviewedSteps.filter((s): s is string => typeof s === "string");
    }
  } catch {
    // malformed JSON
  }
  return [];
}
