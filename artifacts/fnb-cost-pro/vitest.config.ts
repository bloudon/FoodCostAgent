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
 * JSX is handled by the bundled transform, without @vitejs/plugin-react, and
 * the options below override tsconfig's `"jsx": "preserve"`.
 *
 * BOTH declarations are required. Which transform actually runs depends on the
 * resolved Vite version: `oxc` applies to vitest 4's OXC transform, `esbuild`
 * applies when Vite transforms with esbuild — and each silently ignores the
 * other's option. If only one is set and the other transform is the one in use,
 * JSX compiles to the *classic* `React.createElement` runtime and every
 * component test that doesn't import the React namespace fails at render with
 * `ReferenceError: React is not defined`.
 */

// vitest 4 exposes an `oxc` top-level option not yet in upstream Vite types.
interface VitestUserConfig extends UserConfig {
  oxc?: { jsx?: { runtime?: string; importSource?: string } };
}

const root = path.resolve(import.meta.dirname); // artifacts/fnb-cost-pro

const config: VitestUserConfig = {
  root,
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
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
