import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uiSrcDir = path.resolve(__dirname, "..");
const uiDir = path.resolve(uiSrcDir, "..", "ui");

const distDir = path.join(uiDir, "dist");

const srcDir = path.join(uiSrcDir, "src");

function cleanDist() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
}

async function buildInject() {
  await esbuild.build({
    entryPoints: [path.join(srcDir, "inject.ts")],
    outfile: path.join(distDir, "inject.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["es2020"],
    sourcemap: false,
    minify: false,
    legalComments: "none"
  });
}

async function main() {
  cleanDist();
  await buildInject();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
