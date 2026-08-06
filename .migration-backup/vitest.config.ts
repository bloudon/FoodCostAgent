import { defineConfig } from "vitest/config";
import type { UserConfig } from "vite";
import path from "path";

// Vite 8 (used internally by vitest 4) supports an `oxc` transform option
// that overrides tsconfig jsx:preserve so JSX is transformed correctly.
// The outer vite (v5) type definition does not yet include this field.
interface VitestUserConfig extends UserConfig {
  oxc?: { jsx?: { runtime?: string; importSource?: string } };
}

const config: VitestUserConfig = {
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  },
  test: {
    environment: "node",
    include: [
      "client/src/**/*.test.ts",
      "client/src/**/*.test.tsx",
      "server/**/*.test.ts",
    ],
    exclude: ["node_modules", ".cache"],
    environmentMatchGlobs: [
      ["client/src/**/*.component.test.tsx", "jsdom"],
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
};

export default defineConfig(config);
