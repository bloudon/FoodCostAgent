import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }),
  queryClient: { invalidateQueries: vi.fn() },
}));

import { apiRequest } from "@/lib/queryClient";
import { STEP_MILESTONE_IDS, postReviewStep, advanceStep } from "../pages/onboarding-setup";

const apiRequestSpy = apiRequest as ReturnType<typeof vi.fn>;

const KNOWN_MILESTONE_IDS = [
  "menu_scan",
  "plan",
  "store",
  "storage_locations",
  "invoice_scan",
  "categories",
  "recipes",
  "review",
  "inventory_count",
];

const REVIEW_STEP_ENDPOINT = "/api/onboarding/milestones/review-step";

describe("STEP_MILESTONE_IDS", () => {
  it("maps all 9 wizard steps (1–9) to a milestone ID", () => {
    for (let step = 1; step <= 9; step++) {
      expect(typeof STEP_MILESTONE_IDS[step]).toBe("string");
    }
  });

  it("covers exactly steps 1–9", () => {
    const keys = Object.keys(STEP_MILESTONE_IDS).map(Number);
    expect(keys).toHaveLength(9);
    expect(Math.min(...keys)).toBe(1);
    expect(Math.max(...keys)).toBe(9);
  });

  it("maps in the correct order", () => {
    expect(STEP_MILESTONE_IDS[1]).toBe("menu_scan");
    expect(STEP_MILESTONE_IDS[2]).toBe("plan");
    expect(STEP_MILESTONE_IDS[3]).toBe("store");
    expect(STEP_MILESTONE_IDS[4]).toBe("storage_locations");
    expect(STEP_MILESTONE_IDS[5]).toBe("invoice_scan");
    expect(STEP_MILESTONE_IDS[6]).toBe("categories");
    expect(STEP_MILESTONE_IDS[7]).toBe("recipes");
    expect(STEP_MILESTONE_IDS[8]).toBe("review");
    expect(STEP_MILESTONE_IDS[9]).toBe("inventory_count");
  });

  it("all 9 IDs are unique", () => {
    const ids = Object.values(STEP_MILESTONE_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("postReviewStep()", () => {
  beforeEach(() => {
    apiRequestSpy.mockClear();
    apiRequestSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  });

  it("POSTs to review-step with stepId 'categories' (step 5)", async () => {
    await postReviewStep("categories");
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "categories" });
  });

  it("POSTs to review-step with stepId 'storage_locations' (step 6)", async () => {
    await postReviewStep("storage_locations");
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "storage_locations" });
  });

  it("POSTs to review-step with stepId 'recipes' (step 7)", async () => {
    await postReviewStep("recipes");
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "recipes" });
  });

  it("POSTs to review-step with stepId 'review' (step 8)", async () => {
    await postReviewStep("review");
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "review" });
  });

  it("calls the correct milestone ID for each step", async () => {
    for (const milestoneId of Object.values(STEP_MILESTONE_IDS)) {
      apiRequestSpy.mockClear();
      await postReviewStep(milestoneId);
      expect(apiRequestSpy).toHaveBeenCalledTimes(1);
      expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: milestoneId });
    }
  });

  it("swallows errors non-fatally", async () => {
    apiRequestSpy.mockRejectedValueOnce(new Error("Network error"));
    await expect(postReviewStep("categories")).resolves.toBeUndefined();
  });
});

// advanceStep() is the extracted core of the advance() callback in OnboardingSetup.
// advance() delegates to advanceStep(), so these tests also cover the advance() → POST chain.
describe("advanceStep()", () => {
  beforeEach(() => {
    apiRequestSpy.mockClear();
    apiRequestSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  });

  it("step 3 → POSTs with stepId 'store'", async () => {
    await advanceStep(3);
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "store" });
  });

  it("step 4 → POSTs with stepId 'storage_locations'", async () => {
    await advanceStep(4);
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "storage_locations" });
  });

  it("step 5 → POSTs with stepId 'invoice_scan'", async () => {
    await advanceStep(5);
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "invoice_scan" });
  });

  it("step 6 → POSTs with stepId 'categories'", async () => {
    await advanceStep(6);
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "categories" });
  });

  it("step 7 → POSTs with stepId 'recipes'", async () => {
    await advanceStep(7);
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "recipes" });
  });

  it("step 8 → POSTs with stepId 'review'", async () => {
    await advanceStep(8);
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", REVIEW_STEP_ENDPOINT, { stepId: "review" });
  });

  it("each call makes exactly one POST", async () => {
    for (const step of [3, 4, 5, 6, 7, 8]) {
      apiRequestSpy.mockClear();
      await advanceStep(step);
      expect(apiRequestSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("sequential steps 1–9 post milestone IDs in the correct order", async () => {
    for (let step = 1; step <= 9; step++) {
      await advanceStep(step);
    }
    const postedIds = apiRequestSpy.mock.calls.map((call) => (call[2] as { stepId: string }).stepId);
    expect(postedIds).toEqual(KNOWN_MILESTONE_IDS);
  });
});

// Pure function mirroring the completion check in GET /api/onboarding/milestones.
function isMilestoneCompleted(id: string, reviewedSteps: string[], hasData: boolean): boolean {
  return reviewedSteps.includes(id) || hasData;
}

describe("milestone completion logic — steps 5–8", () => {
  describe("categories (step 5)", () => {
    it("incomplete before review-step is posted", () => {
      expect(isMilestoneCompleted("categories", [], false)).toBe(false);
    });

    it("complete after review-step with stepId 'categories'", () => {
      expect(isMilestoneCompleted("categories", ["categories"], false)).toBe(true);
    });

    it("remains incomplete when only other steps are reviewed", () => {
      expect(isMilestoneCompleted("categories", ["recipes", "review"], false)).toBe(false);
    });
  });

  describe("storage_locations (step 6)", () => {
    it("incomplete with no data and no review", () => {
      expect(isMilestoneCompleted("storage_locations", [], false)).toBe(false);
    });

    it("complete via review-step", () => {
      expect(isMilestoneCompleted("storage_locations", ["storage_locations"], false)).toBe(true);
    });

    it("complete via data fallback", () => {
      expect(isMilestoneCompleted("storage_locations", [], true)).toBe(true);
    });
  });

  describe("recipes (step 7)", () => {
    it("incomplete with no data and no review", () => {
      expect(isMilestoneCompleted("recipes", [], false)).toBe(false);
    });

    it("complete via review-step", () => {
      expect(isMilestoneCompleted("recipes", ["recipes"], false)).toBe(true);
    });

    it("complete via data fallback", () => {
      expect(isMilestoneCompleted("recipes", [], true)).toBe(true);
    });
  });

  describe("review (step 8)", () => {
    it("incomplete before review-step is posted", () => {
      expect(isMilestoneCompleted("review", [], false)).toBe(false);
    });

    it("complete after review-step with stepId 'review'", () => {
      expect(isMilestoneCompleted("review", ["review"], false)).toBe(true);
    });
  });

  describe("sequential progression", () => {
    it("all 4 target milestones complete after advancing steps 5–8", () => {
      const reviewed = ["categories", "storage_locations", "recipes", "review"];
      for (const id of reviewed) {
        expect(isMilestoneCompleted(id, reviewed, false)).toBe(true);
      }
    });

    it("skipped earlier steps remain incomplete when later steps are posted", () => {
      const reviewed = ["recipes", "review"];
      expect(isMilestoneCompleted("categories", reviewed, false)).toBe(false);
      expect(isMilestoneCompleted("storage_locations", reviewed, false)).toBe(false);
      expect(isMilestoneCompleted("recipes", reviewed, false)).toBe(true);
      expect(isMilestoneCompleted("review", reviewed, false)).toBe(true);
    });
  });
});
