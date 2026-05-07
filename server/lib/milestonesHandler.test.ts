import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";

import {
  createReviewStepHandler,
  createGetMilestonesHandler,
  computeMilestones,
  isMilestoneCompleted,
  parseReviewedSteps,
  REVIEW_ONLY_MILESTONES,
  type ReviewStepDeps,
  type GetMilestonesDeps,
} from "./milestonesHandler";

function makeSharedStore() {
  const store = new Map<string, string>();

  const reviewStepDeps: ReviewStepDeps = {
    async getProgress(companyId) {
      const raw = store.get(companyId);
      return raw ? { stepData: raw } : null;
    },
    async upsertProgress(companyId, stepData) {
      store.set(companyId, stepData);
    },
  };

  const getMilestonesDeps: GetMilestonesDeps = {
    async getProgress(companyId) {
      const raw = store.get(companyId);
      return raw ? { stepData: raw, isCompleted: null } : null;
    },
    async getDataPresence(_companyId) {
      return {
        hasMenuItems: false,
        hasPlan: false,
        hasInventoryItems: false,
        hasStorageLocations: false,
        hasRecipes: false,
        hasInventoryCount: false,
      };
    },
    async markCompleted(_companyId) {},
  };

  return { store, reviewStepDeps, getMilestonesDeps };
}

function makeApp(companyId: string | null, reviewDeps: ReviewStepDeps, getDeps: GetMilestonesDeps) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    if (companyId !== null) req.user = { companyId };
    next();
  });
  app.post("/api/onboarding/milestones/review-step", createReviewStepHandler(reviewDeps));
  app.get("/api/onboarding/milestones", createGetMilestonesHandler(getDeps));
  return app;
}

const TARGET_STEPS = [
  { stepId: "categories", wizardStep: 4 },
  { stepId: "storage_locations", wizardStep: 5 },
  { stepId: "recipes", wizardStep: 6 },
  { stepId: "review", wizardStep: 7 },
];

describe("POST review-step → GET milestones integration (steps 4–7)", () => {
  for (const { stepId, wizardStep } of TARGET_STEPS) {
    describe(`step ${wizardStep}: "${stepId}"`, () => {
      it("GET returns completed: false before review-step is posted", async () => {
        const { reviewStepDeps, getMilestonesDeps } = makeSharedStore();
        const app = makeApp(`co-before-${stepId}`, reviewStepDeps, getMilestonesDeps);

        const res = await request(app).get("/api/onboarding/milestones");
        expect(res.status).toBe(200);
        const milestone = (res.body.milestones as { id: string; completed: boolean }[])
          .find((m) => m.id === stepId);
        expect(milestone?.completed).toBe(false);
      });

      it("GET returns completed: true after review-step is posted", async () => {
        const { reviewStepDeps, getMilestonesDeps } = makeSharedStore();
        const app = makeApp(`co-after-${stepId}`, reviewStepDeps, getMilestonesDeps);

        const postRes = await request(app)
          .post("/api/onboarding/milestones/review-step")
          .send({ stepId });
        expect(postRes.status).toBe(200);
        expect(postRes.body).toEqual({ success: true });

        const getRes = await request(app).get("/api/onboarding/milestones");
        const milestone = (getRes.body.milestones as { id: string; completed: boolean }[])
          .find((m) => m.id === stepId);
        expect(milestone?.completed).toBe(true);
      });

      it("completedCount increases by 1 after review-step is posted", async () => {
        const { reviewStepDeps, getMilestonesDeps } = makeSharedStore();
        const app = makeApp(`co-count-${stepId}`, reviewStepDeps, getMilestonesDeps);

        const before = await request(app).get("/api/onboarding/milestones");
        await request(app).post("/api/onboarding/milestones/review-step").send({ stepId });
        const after = await request(app).get("/api/onboarding/milestones");

        expect(after.body.completedCount).toBe(before.body.completedCount + 1);
      });
    });
  }
});

describe("wizard progression: steps 4–7 accumulate correctly", () => {
  it("all 4 milestones show completed after posting all 4 steps", async () => {
    const { reviewStepDeps, getMilestonesDeps } = makeSharedStore();
    const app = makeApp("prog-co", reviewStepDeps, getMilestonesDeps);

    for (const { stepId } of TARGET_STEPS) {
      await request(app).post("/api/onboarding/milestones/review-step").send({ stepId });
    }

    const getRes = await request(app).get("/api/onboarding/milestones");
    const milestones = getRes.body.milestones as { id: string; completed: boolean }[];
    for (const { stepId } of TARGET_STEPS) {
      expect(milestones.find((m) => m.id === stepId)?.completed).toBe(true);
    }
  });

  it("skipped earlier steps remain incomplete when later steps are posted", async () => {
    const { reviewStepDeps, getMilestonesDeps } = makeSharedStore();
    const app = makeApp("partial-co", reviewStepDeps, getMilestonesDeps);

    await request(app).post("/api/onboarding/milestones/review-step").send({ stepId: "recipes" });
    await request(app).post("/api/onboarding/milestones/review-step").send({ stepId: "review" });

    const milestones = (await request(app).get("/api/onboarding/milestones"))
      .body.milestones as { id: string; completed: boolean }[];

    expect(milestones.find((m) => m.id === "categories")?.completed).toBe(false);
    expect(milestones.find((m) => m.id === "storage_locations")?.completed).toBe(false);
    expect(milestones.find((m) => m.id === "recipes")?.completed).toBe(true);
    expect(milestones.find((m) => m.id === "review")?.completed).toBe(true);
  });
});

describe("POST /api/onboarding/milestones/review-step — guards", () => {
  it("returns 400 when companyId is missing", async () => {
    const { reviewStepDeps, getMilestonesDeps } = makeSharedStore();
    const res = await request(makeApp(null, reviewStepDeps, getMilestonesDeps))
      .post("/api/onboarding/milestones/review-step")
      .send({ stepId: "categories" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/company/i);
  });

  it("returns 400 when stepId is missing", async () => {
    const { reviewStepDeps, getMilestonesDeps } = makeSharedStore();
    const res = await request(makeApp("co-guard", reviewStepDeps, getMilestonesDeps))
      .post("/api/onboarding/milestones/review-step")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stepId/i);
  });

  it("is idempotent — posting the same stepId twice stores it only once", async () => {
    const { reviewStepDeps, getMilestonesDeps } = makeSharedStore();
    const app = makeApp("co-idem", reviewStepDeps, getMilestonesDeps);

    await request(app).post("/api/onboarding/milestones/review-step").send({ stepId: "categories" });
    await request(app).post("/api/onboarding/milestones/review-step").send({ stepId: "categories" });

    const raw = (await reviewStepDeps.getProgress("co-idem"))?.stepData;
    const parsed = JSON.parse(raw!) as { reviewedSteps: string[] };
    expect(parsed.reviewedSteps.filter((s) => s === "categories")).toHaveLength(1);
  });
});

describe("computeMilestones()", () => {
  const emptyData = {
    hasMenuItems: false,
    hasPlan: false,
    hasInventoryItems: false,
    hasStorageLocations: false,
    hasRecipes: false,
    hasInventoryCount: false,
  };

  it("returns 8 milestones", () => {
    expect(computeMilestones([], emptyData)).toHaveLength(8);
  });

  it("all milestones incomplete when reviewedSteps is empty and no data", () => {
    expect(computeMilestones([], emptyData).every((m) => !m.completed)).toBe(true);
  });

  it("categories completes only via reviewedSteps (no data fallback)", () => {
    expect(computeMilestones([], emptyData).find((m) => m.id === "categories")!.completed).toBe(false);
    expect(computeMilestones(["categories"], emptyData).find((m) => m.id === "categories")!.completed).toBe(true);
  });

  it("review completes only via reviewedSteps (no data fallback)", () => {
    expect(computeMilestones([], emptyData).find((m) => m.id === "review")!.completed).toBe(false);
    expect(computeMilestones(["review"], emptyData).find((m) => m.id === "review")!.completed).toBe(true);
  });

  it("storage_locations completes via reviewedSteps or hasStorageLocations", () => {
    expect(computeMilestones(["storage_locations"], emptyData).find((m) => m.id === "storage_locations")!.completed).toBe(true);
    expect(computeMilestones([], { ...emptyData, hasStorageLocations: true }).find((m) => m.id === "storage_locations")!.completed).toBe(true);
  });

  it("recipes completes via reviewedSteps or hasRecipes", () => {
    expect(computeMilestones(["recipes"], emptyData).find((m) => m.id === "recipes")!.completed).toBe(true);
    expect(computeMilestones([], { ...emptyData, hasRecipes: true }).find((m) => m.id === "recipes")!.completed).toBe(true);
  });

  it("all 4 target milestones complete after reviewing all 4", () => {
    const reviewed = ["categories", "storage_locations", "recipes", "review"];
    const milestones = computeMilestones(reviewed, emptyData);
    for (const id of reviewed) {
      expect(milestones.find((m) => m.id === id)!.completed).toBe(true);
    }
  });
});

describe("parseReviewedSteps", () => {
  it("returns [] for null input", () => {
    expect(parseReviewedSteps(null)).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseReviewedSteps("not-json")).toEqual([]);
  });

  it("returns the correct array from valid stepData JSON", () => {
    expect(parseReviewedSteps(JSON.stringify({ reviewedSteps: ["categories", "recipes"] }))).toEqual(["categories", "recipes"]);
  });

  it("filters out non-string entries", () => {
    expect(parseReviewedSteps(JSON.stringify({ reviewedSteps: ["categories", 42, null, "review"] }))).toEqual(["categories", "review"]);
  });
});

describe("isMilestoneCompleted", () => {
  it("returns true when stepId is in reviewedSteps", () => {
    expect(isMilestoneCompleted("categories", ["categories"], false)).toBe(true);
  });

  it("returns true when hasData is true", () => {
    expect(isMilestoneCompleted("storage_locations", [], true)).toBe(true);
  });

  it("returns false when neither reviewedSteps nor hasData", () => {
    expect(isMilestoneCompleted("categories", [], false)).toBe(false);
  });
});

describe("REVIEW_ONLY_MILESTONES", () => {
  it("contains 'categories' and 'review'", () => {
    expect(REVIEW_ONLY_MILESTONES.has("categories")).toBe(true);
    expect(REVIEW_ONLY_MILESTONES.has("review")).toBe(true);
  });

  it("does not contain milestones with data fallbacks", () => {
    expect(REVIEW_ONLY_MILESTONES.has("storage_locations")).toBe(false);
    expect(REVIEW_ONLY_MILESTONES.has("recipes")).toBe(false);
  });
});

describe("DB failure — handlers return 500 JSON", () => {
  it("POST review-step returns 500 when getProgress() throws", async () => {
    const deps: ReviewStepDeps = {
      async getProgress() { throw new Error("DB down"); },
      async upsertProgress() {},
    };
    const res = await request(makeApp("co-fail", deps, makeSharedStore().getMilestonesDeps))
      .post("/api/onboarding/milestones/review-step")
      .send({ stepId: "categories" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  it("POST review-step returns 500 when upsertProgress() throws", async () => {
    const deps: ReviewStepDeps = {
      async getProgress() { return null; },
      async upsertProgress() { throw new Error("write failed"); },
    };
    const res = await request(makeApp("co-fail2", deps, makeSharedStore().getMilestonesDeps))
      .post("/api/onboarding/milestones/review-step")
      .send({ stepId: "categories" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  it("GET milestones returns 500 when getProgress() throws", async () => {
    const deps: GetMilestonesDeps = {
      async getProgress() { throw new Error("DB down"); },
      async getDataPresence() {
        return { hasMenuItems: false, hasPlan: false, hasInventoryItems: false,
          hasStorageLocations: false, hasRecipes: false, hasInventoryCount: false };
      },
      async markCompleted() {},
    };
    const res = await request(makeApp("co-fail3", makeSharedStore().reviewStepDeps, deps))
      .get("/api/onboarding/milestones");
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  it("GET milestones returns 500 when getDataPresence() throws", async () => {
    const deps: GetMilestonesDeps = {
      async getProgress() { return null; },
      async getDataPresence() { throw new Error("timeout"); },
      async markCompleted() {},
    };
    const res = await request(makeApp("co-fail4", makeSharedStore().reviewStepDeps, deps))
      .get("/api/onboarding/milestones");
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
