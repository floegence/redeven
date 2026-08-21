import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nodeVersion = "26.7.0";
const nodeEngine = ">=26.0.0 <27";
const nodeTypes = "^26.0.0";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the repository root owns the exact Node toolchain contract", () => {
  assert.equal(source(".node-version"), `${nodeVersion}\n`);
  assert.match(source("AGENTS.md"), /`\.node-version` is the single source of truth for the first-party Node\.js toolchain/);
});

test("every GitHub Node setup reads .node-version", () => {
  for (const path of [".github/workflows/ci-check.yml", ".github/workflows/release.yml"]) {
    const workflow = source(path);
    const setups = [...workflow.matchAll(/^\s+uses: actions\/setup-node@[^\n]+$/gm)];
    assert.ok(setups.length > 0, `${path} has no Node setup`);
    for (const setup of setups) {
      const block = workflow.slice(setup.index, setup.index + 220);
      assert.match(block, /^\s+node-version-file: \.node-version$/m, `${path} omits .node-version`);
      assert.doesNotMatch(block, /^\s+node-version:/m, `${path} hard-codes Node`);
    }
  }
});

test("all first-party Node packages require only Node 26", () => {
  for (const path of [
    "desktop/package.json",
    "internal/envapp/ui_src/package.json",
    "internal/codeapp/ui_src/package.json",
  ]) {
    assert.equal(JSON.parse(source(path)).engines?.node, nodeEngine, path);
  }
});

test("Desktop and Env App compile against Node 26 types", () => {
  for (const directory of ["desktop", "internal/envapp/ui_src"]) {
    const manifest = JSON.parse(source(`${directory}/package.json`));
    const lock = JSON.parse(source(`${directory}/package-lock.json`));
    assert.equal(manifest.devDependencies?.["@types/node"], nodeTypes, `${directory} manifest`);
    assert.equal(lock.packages?.[""]?.devDependencies?.["@types/node"], nodeTypes, `${directory} npm lock`);
    assert.match(lock.packages?.["node_modules/@types/node"]?.version ?? "", /^26\./, `${directory} resolved types`);
  }
});

test("development entrypoints explicitly enforce Node major 26", () => {
  const helper = source("scripts/ui_package_common.sh");
  const desktop = source("scripts/dev_desktop.sh");
  const pluginSmoke = source("scripts/smoke_desktop_plugins.sh");
  assert.match(helper, /ui_pkg_require_node_26\(\)/);
  assert.match(helper, /Node\.js 26\.x is required/);
  assert.match(desktop, /ui_pkg_require_node_26/);
  assert.match(pluginSmoke, /ui_pkg_require_node_26/);
  assert.doesNotMatch(desktop, /Node\.js 24\+/);
  assert.doesNotMatch(pluginSmoke, /\/node\/v24\./);
});

test("dev Desktop installs dependencies before resolving Electron", () => {
  const desktop = source("scripts/dev_desktop.sh");
  const mainStart = desktop.indexOf("main() {");
  const dependencyInstall = desktop.indexOf("\n  ensure_desktop_dependencies\n", mainStart);
  const desktopStart = desktop.indexOf("\n  start_desktop\n", mainStart);
  const dependencyFunction = desktop.indexOf("ensure_desktop_dependencies() {");
  const dependencyFunctionEnd = desktop.indexOf("\n}\n", dependencyFunction);

  assert.ok(mainStart >= 0, "dev Desktop must have a main entrypoint");
  assert.ok(dependencyInstall >= 0, "dev Desktop must preflight dependencies");
  assert.ok(desktopStart >= 0, "dev Desktop must start after dependency preflight");
  assert.ok(dependencyInstall < desktopStart, "dependency installation must precede Desktop start");
  assert.ok(dependencyFunctionEnd > dependencyFunction, "dependency preflight must be a complete function");
  assert.match(desktop.slice(dependencyFunction, dependencyFunctionEnd), /npm ci/);
  assert.match(desktop.slice(dependencyFunction, dependencyFunctionEnd), /require\.resolve\("electron"\)/);
});

test("canonical and localized READMEs publish the exact Node 26 badge and prerequisite", () => {
  const localeManifest = JSON.parse(source("assets/readme/locales.json"));
  for (const { file } of localeManifest.locales) {
    const readme = source(file);
    assert.match(readme, /img\.shields\.io\/badge\/Node\.js-26\.7\.0-339933/);
    assert.match(readme, /Node\.js `26\.7\.0`/);
    assert.doesNotMatch(readme, /Node\.js-24-|Node\.js `24`/);
  }
});
