import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    alias: {
      "@ovlive/api-types": path.resolve(repoRoot, "packages/api-types/src/index.ts"),
      "@ovlive/shared": path.resolve(repoRoot, "packages/shared/src/index.ts"),
    },
  },
  server: {
    // allow importing the workspace packages from outside apps/web
    fs: { allow: [repoRoot] },
  },
});
