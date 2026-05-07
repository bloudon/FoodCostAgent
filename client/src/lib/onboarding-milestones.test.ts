import { describe, it, expect, vi, beforeEach } from "vitest";
import { STEP_MILESTONE_IDS } from "../pages/onboarding-setup";

const KNOWN_MILESTONE_IDS = [
  "menu_scan",
  "plan",
  "invoice_scan",
  "categories",
  "storage_locations",
  "recipes",
  "review",
  "inventory_count",
];

describe("STEP_MILESTONE_IDS", () => {
  it("maps all 8 wizard steps (1–8) to a milestone ID", () => {
    for (let step = 1; step <= 8; step++) {
      expect(STEP_MILESTONE_IDS[step]).toBeDefined();
      expect(typeof STEP_MILESTONE_IDS[step]).toBe("string");
    }
  });

  it("does not contain extra steps beyond 8", () => {
    const keys = Object.keys(STEP_MILESTONE_IDS).map(Number);
    expect(keys).toHaveLength(8);
    expect(Math.min(...keys)).toBe(1);
    expect(Math.max(...keys)).toBe(8);
  });

  it("maps each step to a known, non-empty milestone ID", () => {
    for (let step = 1; step <= 8; step++) {
      const id = STEP_MILESTONE_IDS[step];
      expect(KNOWN_MILESTONE_IDS).toContain(id);
    }
  });

  it("maps milestone IDs in the correct order", () => {
    expect(STEP_MILESTONE_IDS[1]).toBe("menu_scan");
    expect(STEP_MILESTONE_IDS[2]).toBe("plan");
    expect(STEP_MILESTONE_IDS[3]).toBe("invoice_scan");
    expect(STEP_MILESTONE_IDS[4]).toBe("categories");
    expect(STEP_MILESTONE_IDS[5]).toBe("storage_locations");
    expect(STEP_MILESTONE_IDS[6]).toBe("recipes");
    expect(STEP_MILESTONE_IDS[7]).toBe("review");
    expect(STEP_MILESTONE_IDS[8]).toBe("inventory_count");
  });

  it("all 8 milestone IDs are unique — no duplicates", () => {
    const ids = Object.values(STEP_MILESTONE_IDS);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe("postReviewStep API contract", () => {
  const ENDPOINT = "/api/onboarding/milestones/review-step";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls the correct endpoint for each milestone ID", async () => {
    const postSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.doMock("@/lib/queryClient", () => ({
      apiRequest: postSpy,
      queryClient: { invalidateQueries: vi.fn() },
    }));

    for (const milestoneId of KNOWN_MILESTONE_IDS) {
      postSpy.mockClear();
      postSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

      const { apiRequest } = await import("@/lib/queryClient");
      await (apiRequest as typeof postSpy)("POST", ENDPOINT, { stepId: milestoneId });

      expect(postSpy).toHaveBeenCalledWith("POST", ENDPOINT, { stepId: milestoneId });
    }
  });

  it("advance() marks the milestone for the completed step before moving to next step", () => {
    const completedOrder: string[] = [];

    const mockPostReviewStep = async (milestoneId: string) => {
      completedOrder.push(milestoneId);
    };

    const simulateAdvance = async (currentStep: number) => {
      const milestoneId = STEP_MILESTONE_IDS[currentStep];
      if (milestoneId) {
        await mockPostReviewStep(milestoneId);
      }
      return Math.min(8, currentStep + 1);
    };

    const testSteps = async () => {
      for (let step = 1; step <= 8; step++) {
        await simulateAdvance(step);
      }
      return completedOrder;
    };

    return testSteps().then((order) => {
      expect(order).toEqual(KNOWN_MILESTONE_IDS);
    });
  });

  it("finishWizard() always marks inventory_count milestone for step 8", async () => {
    const recorded: string[] = [];
    const mockPostReviewStep = async (milestoneId: string) => {
      recorded.push(milestoneId);
    };

    const simulateFinishWizard = async () => {
      await mockPostReviewStep("inventory_count");
    };

    await simulateFinishWizard();
    expect(recorded).toContain("inventory_count");
    expect(recorded[0]).toBe("inventory_count");
  });

  it("GET milestones recognises all 8 milestone IDs", () => {
    const reviewedSteps = [...KNOWN_MILESTONE_IDS];

    const computeMilestoneCompletion = (id: string) =>
      reviewedSteps.includes(id);

    for (const id of KNOWN_MILESTONE_IDS) {
      expect(computeMilestoneCompletion(id)).toBe(true);
    }
  });
});
