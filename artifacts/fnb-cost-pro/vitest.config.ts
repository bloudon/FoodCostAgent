import path from "path";
import { defineConfig } from "vitest/config";
import type { UserConfig } from "vite";

/**
 * Vitest configuration for @workspace/fnb-cost-pro.
 *
 * Run:  pnpm --filter @workspace/fnb-cost-pro test
 *        or:  pnpm run test  (from this directory)
 *
 * React version note
 * ------------------
 * All workspace packages use React 19 (from pnpm-workspace.yaml catalog).
 * React 19 is also declared at the workspace root so @testing-library/react
 * and the OXC JSX transform resolve to the same single instance.
 *
 * JSX note
 * --------
 * vitest 4's built-in OXC transform handles JSX without @vitejs/plugin-react.
 * The `oxc` top-level option overrides tsconfig's `"jsx": "preserve"`.
 */

// vitest 4 exposes an `oxc` top-level option not yet in upstream Vite types.
interface VitestUserConfig extends UserConfig {
  oxc?: { jsx?: { runtime?: string; importSource?: string } };
}

const root = path.resolve(import.meta.dirname); // artifacts/fnb-cost-pro

const config: VitestUserConfig = {
  root,
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  test: {
    root,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules"],
    // Component tests also get jsdom via the per-file annotation
    // `// @vitest-environment jsdom`.  This glob is a belt-and-suspenders
    // fallback for any *.component.test.tsx that lacks the annotation.
    environmentMatchGlobs: [
      ["src/**/*.component.test.tsx", "jsdom"],
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@shared": path.resolve(root, "src", "shared"),
      "@assets": path.resolve(root, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
};

export default defineConfig(config);
