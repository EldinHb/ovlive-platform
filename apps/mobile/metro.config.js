// Metro for a pnpm workspace with node-linker=hoisted. The two @ovlive/* packages are
// symlinked into node_modules and ship raw TypeScript (their `main` is src/index.ts), so the
// repo root has to be a watch folder for Metro to transform them, and module lookup has to
// see the root node_modules for their dependencies (protobufjs).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
