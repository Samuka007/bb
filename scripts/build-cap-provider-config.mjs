import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPluginApp,
  resolvePluginBuildToolchain,
} from "../packages/plugin-build/src/index.ts";

/**
 * Build the cap-provider-config frontend plugin (cloudflare-agent-project
 * #362/#382) into `plugins/cap-provider-config/dist/`. The cap server-worker
 * staging (stage-bb-spa.sh) runs this before staging the bundle assets, and
 * computes the served hash from the three dist files — app.js + app.css +
 * app.meta.json — exactly like the bb server's loadPluginAppBundle.
 *
 * Standalone on purpose: NOT wired into the builtin registry / OFFICIAL_PLUGINS
 * — the cap static registry serves this one plugin without porting bb's
 * BUILTIN_PLUGINS core (ticket #382 scope note).
 */

const repositoryRoot = resolve(import.meta.dirname, "..");

const toolchain = await resolvePluginBuildToolchain(
  resolve(repositoryRoot, "node_modules/.bb-toolchain"),
);

const rootDirectory = resolve(repositoryRoot, "plugins", "cap-provider-config");
await rm(resolve(rootDirectory, "dist"), { recursive: true, force: true });

// bbVersion feeds dist/app.meta.json (builtWith.bbVersion) — the plugin ships
// with the fork it lives in, so the fork's own package version is the stamp.
const bbPackage = JSON.parse(
  await readFile(resolve(repositoryRoot, "packages/bb-app/package.json"), "utf8"),
);
if (typeof bbPackage.version !== "string") {
  throw new Error("packages/bb-app/package.json is missing a version");
}

const app = await buildPluginApp(rootDirectory, bbPackage.version, toolchain);
console.log(
  `cap-provider-config: built ${app.jsPath}, ${app.cssPath}, and ${app.metaPath}`,
);