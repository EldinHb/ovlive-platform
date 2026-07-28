import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    alias: {
      "@ovlive/api-types": path.resolve(repoRoot, "packages/api-types/src/index.ts"),
    },
  },
  server: {
    // allow importing the shared package + ovlive.proto from outside apps/web
    fs: { allow: [repoRoot] },
  },
});
