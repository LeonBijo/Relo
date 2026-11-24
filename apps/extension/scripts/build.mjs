import { build as viteBuild } from "vite";
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = resolve(rootDir, "dist");

async function main() {
  rmSync(distDir, { recursive: true, force: true });

  // 1. Build popup HTML/React/Tailwind bundle with Vite
  await viteBuild({
    configFile: resolve(rootDir, "vite.config.ts"),
  });

  // 2. Build MV3 service worker as a single ESM bundle
  await esbuild.build({
    entryPoints: [resolve(rootDir, "src/background/index.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    outfile: resolve(distDir, "background.js"),
    sourcemap: false,
    minify: true,
    logLevel: "info",
  });

  // 3. Build YouTube content script as a self-contained IIFE bundle
  await esbuild.build({
    entryPoints: [resolve(rootDir, "src/content/index.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    outfile: resolve(distDir, "content.js"),
    sourcemap: false,
    minify: true,
    logLevel: "info",
  });

  // 4. Package Roboto OFL license alongside the built extension
  mkdirSync(resolve(distDir, "fonts"), { recursive: true });
  cpSync(
    resolve(rootDir, "src/fonts/OFL.txt"),
    resolve(distDir, "fonts/OFL.txt"),
  );

  console.log("RELO extension build complete:", distDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
