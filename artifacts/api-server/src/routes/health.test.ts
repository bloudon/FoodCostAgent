import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import healthRouter from "./health";

describe("deployment health routes", () => {
  const app = express();

  beforeEach(() => {
    app.use("/api", healthRouter);
  });

  it("exposes the active build identity at /api/build-info", async () => {
    const response = await request(app).get("/api/build-info");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      service: "fnb-cost-pro-api",
      buildId: process.env.APP_BUILD_ID ?? null,
    });
  });
});