import { defineConfig } from "vitest/config";

// Resolves the `@/` imports the dashboard's components use.
export default defineConfig({ resolve: { tsconfigPaths: true } });
