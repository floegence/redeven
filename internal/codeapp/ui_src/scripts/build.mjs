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
  const outfile = path.join(distDir, "inject.js");
  await esbuild.build({
    entryPoints: [path.join(srcDir, "inject.ts")],
    outfile,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["es2020"],
    sourcemap: false,
    minify: false,
    legalComments: "none"
  });
  console.log(`Code App inject bundle ready: ${path.relative(uiSrcDir, outfile)}`);
}

async function main() {
  console.log("Bundling Code App inject UI...");
  cleanDist();
  await buildInject();
  await esbuild.build({ entryPoints: [path.join(srcDir, "windowTransport.ts")], outfile: path.join(distDir,"window-transport.js"),
    bundle:true, platform:"browser", format:"iife", globalName:"RedevenWindowTransport", target:["es2022"], sourcemap:false, minify:true, legalComments:"none" });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
