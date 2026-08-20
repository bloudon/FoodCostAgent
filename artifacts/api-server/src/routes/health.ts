import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Deployment identity only. This intentionally exposes no Git metadata,
 * credentials, or database details; the production preflight uses it to prove
 * the actively serving API is the exact reviewed build, not merely a newer
 * checkout on the same host.
 */
router.get("/build-info", (_req, res) => {
  res.json({ service: "fnb-cost-pro-api", buildId: process.env.APP_BUILD_ID ?? null });
});

export default router;
