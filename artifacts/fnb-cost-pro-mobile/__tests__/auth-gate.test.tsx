// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  isLoading: false,
  segments: ["login"] as string[],
  replace: vi.fn(),
}));

vi.mock("expo-router", () => ({
  router: { replace: state.replace },
  useSegments: () => state.segments,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: state.user, isLoading: state.isLoading }),
}));

import { AuthGate, getAuthRedirect } from "../components/AuthGate";

afterEach(() => {
  cleanup();
});

describe("getAuthRedirect", () => {
  it("routes logged-out users to login", () => {
    expect(getAuthRedirect(null, false, "(tabs)")).toBe("/login");
  });

  it("routes authenticated users away from login", () => {
    expect(getAuthRedirect({ id: "user" }, false, "login")).toBe("/");
  });

  it("does not redirect while auth is hydrating", () => {
    expect(getAuthRedirect(null, true, "(tabs)")).toBeNull();
  });
});

describe("AuthGate", () => {
  beforeEach(() => {
    state.user = null;
    state.isLoading = false;
    state.segments = ["login"];
    state.replace.mockReset();
  });

  it("renders login content without redirecting when logged out", () => {
    render(
      <AuthGate>
        <div>login content</div>
      </AuthGate>,
    );

    expect(screen.getByText("login content")).toBeTruthy();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("withholds protected content and redirects once after render", async () => {
    state.segments = ["(tabs)"];

    await act(async () => {
      render(
        <AuthGate>
          <div>protected content</div>
        </AuthGate>,
      );
    });

    expect(screen.queryByText("protected content")).toBeNull();
    expect(state.replace).toHaveBeenCalledOnce();
    expect(state.replace).toHaveBeenCalledWith("/login");
  });

  it("withholds login content and redirects authenticated users once", async () => {
    state.user = { id: "user" };

    await act(async () => {
      render(
        <AuthGate>
          <div>login content</div>
        </AuthGate>,
      );
    });

    expect(screen.queryByText("login content")).toBeNull();
    expect(state.replace).toHaveBeenCalledOnce();
    expect(state.replace).toHaveBeenCalledWith("/");
  });
});