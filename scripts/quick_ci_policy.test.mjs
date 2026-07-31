import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci-check.yml", import.meta.url), "utf8");
const codeqlWorkflow = readFileSync(new URL("../.github/workflows/codeql.yml", import.meta.url), "utf8");
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const quickGate = readFileSync(new URL("./check_quick_ci.sh", import.meta.url), "utf8");
const finalGate = readFileSync(new URL("./check_final_integration.sh", import.meta.url), "utf8");
const uiGate = readFileSync(new URL("./check_ui_tests.sh", import.meta.url), "utf8");
const jobsSource = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
const releaseJobsSource = releaseWorkflow.slice(releaseWorkflow.indexOf("\njobs:\n") + "\njobs:\n".length);

const allowedQuickGateCommands = new Set([
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)',
  'ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)',
  'cd "$ROOT_DIR"',
  'echo "[INFO] checking repository diff and Go formatting"',
  "git diff --check",
  "git diff-tree --check --root -r --no-commit-id HEAD",
  'test -z "$(gofmt -l $(git ls-files \'*.go\'))"',
  'echo "[INFO] checking shell, JavaScript, and Python syntax"',
  "for script in scripts/*.sh scripts/okf/*.sh .githooks/pre-commit .githooks/pre-push; do",
  'bash -n "$script"',
  "done",
  "for script in scripts/*.mjs; do",
  'node --check "$script"',
  'python3 -c \'from pathlib import Path; [compile(Path(name).read_text(encoding="utf-8"), name, "exec") for name in ("scripts/safe_extract_tar.py", "scripts/extract_desktop_runtime.py")]\'',
  'echo "[INFO] checking bounded cloud policy and committed knowledge artifacts"',
  "node --test scripts/quick_ci_policy.test.mjs scripts/actionlint_runner_policy.test.mjs",
  "node --test scripts/check_readme_localizations.test.mjs",
  "node scripts/check_readme_localizations.mjs",
  "./scripts/okf/check_source_integrity.sh",
  "./scripts/build_okf_bundle.sh --verify-only",
  'echo "[INFO] quick CI passed"',
]);

function assertClosedQuickGate(source) {
  const commands = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  for (const command of commands) {
    assert.ok(allowedQuickGateCommands.has(command), `unexpected quick gate command: ${command}`);
  }
}

test("ordinary GitHub CI is one bounded source-only job", () => {
  assert.match(workflow, /^name: Quick CI$/m);
  assert.match(workflow, /^\s{4}name: Quick CI$/m);
  assert.match(workflow, /^\s{4}timeout-minutes: 5$/m);
  assert.match(workflow, /\.\/scripts\/check_quick_ci\.sh/);
  assert.deepEqual(
    [...jobsSource.matchAll(/^  ([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]),
    ["quick-ci"],
  );
  assert.deepEqual(
    [...workflow.matchAll(/^\s+run: (.+)$/gm)].map((match) => match[1]),
    ["./scripts/check_quick_ci.sh"],
  );

  for (const forbidden of [
    "check_final_integration",
    "playwright",
    "chromium",
    "electron-builder",
    "go test",
    "pnpm install",
    "npm ci",
    "built-dist",
    "terminal-carrier",
    "check_flower_ui",
    "check_desktop",
    "docker",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(forbidden, "i"));
  }
});

test("CodeQL scans changed main daily without joining push or pull request CI", () => {
  assert.match(codeqlWorkflow, /^name: CodeQL$/m);
  assert.match(codeqlWorkflow, /^  workflow_dispatch: \{\}$/m);
  assert.match(codeqlWorkflow, /^  schedule:$/m);
  assert.match(codeqlWorkflow, /^    - cron: "17 3 \* \* \*"$/m);
  assert.doesNotMatch(codeqlWorkflow, /^  (?:push|pull_request):/m);
  assert.match(codeqlWorkflow, /event=schedule&status=success&per_page=1/);
  assert.match(codeqlWorkflow, /previous_sha.*HEAD_SHA/s);
  assert.match(codeqlWorkflow, /should_scan=false/);
  assert.match(codeqlWorkflow, /Could not inspect previous CodeQL runs; scanning fail-safe/);
  assert.match(codeqlWorkflow, /if: needs\.plan\.outputs\.should_scan == 'true'/);
  assert.deepEqual(
    [...codeqlWorkflow.matchAll(/^          - language: (.+)$/gm)].map((match) => match[1]),
    ["actions", "go", "javascript-typescript", "python"],
  );
});

test("quick gate checks the committed tree instead of trusting a clean checkout", () => {
  assert.match(quickGate, /git diff-tree --check --root -r --no-commit-id HEAD/);
});

test("README localization gates enforce synchronization without reviewer flags", () => {
  assert.match(quickGate, /^node scripts\/check_readme_localizations\.mjs$/m);
  assert.match(
    finalGate,
    /run_step "checking synchronized README localizations" node scripts\/check_readme_localizations\.mjs/,
  );
  assert.doesNotMatch(`${quickGate}\n${finalGate}`, /--require-reviewed/);
});

test("quick gate remains a closed source-only command set", () => {
  assertClosedQuickGate(quickGate);

  for (const forbidden of [
    "playwright",
    "chromium",
    "vitest",
    "go test",
    "pnpm",
    "npm ci",
    "terminal-carrier",
    "terminal-performance",
    "check_final_integration",
    "check_ui_tests",
    "check_renderer_e2e",
    "check_flower_ui",
    "check_desktop",
    "docker",
  ]) {
    assert.doesNotMatch(quickGate, new RegExp(forbidden, "i"));
  }
});

test("quick gate cannot hide work after a logging command", () => {
  const mutatedGate = quickGate.replace(
    'echo "[INFO] quick CI passed"',
    'echo "[INFO] quick CI passed"; ./scripts/check_plugin_integration.sh --ci',
  );
  assert.throws(
    () => assertClosedQuickGate(mutatedGate),
    /unexpected quick gate command: .*check_plugin_integration/,
  );
});

test("exact-main pre-push owns complete UI and browser coverage", () => {
  assert.match(finalGate, /run_step "testing complete UI packages" \.\/scripts\/check_ui_tests\.sh/);
  assert.match(finalGate, /run_step "checking Flower UI" \.\/scripts\/check_flower_ui\.sh --skip-browser/);
  assert.match(uiGate, /^\s*ui_pkg_run_pnpm test$/m);
  assert.match(uiGate, /^\s*ui_pkg_run_pnpm run test:browser$/m);
  assert.match(uiGate, /^\s*run_terminal_performance$/m);
  assert.match(uiGate, /^\s*npm test$/m);
  assert.match(uiGate, /pnpm run test:terminal-performance/);
});

test("release workflow validates exact main and contains no test gate", () => {
  assert.match(releaseWorkflow, /^  release-ref:$/m);
  assert.match(releaseWorkflow, /refs\/remotes\/origin\/main/);
  assert.match(releaseWorkflow, /tagged_commit.*main_commit/s);
  assert.match(releaseWorkflow, /tagged_commit.*GITHUB_SHA/s);
  assert.equal(
    [...releaseJobsSource.matchAll(/^  ([a-z][a-z0-9-]*):$/gm)].length,
    [...releaseJobsSource.matchAll(/^    timeout-minutes: [0-9]+$/gm)].length,
  );
  const desktopInstallOffset = releaseWorkflow.indexOf("run: npm ci --no-audit --no-fund");
  const desktopPackageOffset = releaseWorkflow.indexOf("npm run package --");
  assert.ok(desktopInstallOffset > 0, "release must install Desktop build dependencies");
  assert.ok(desktopPackageOffset > desktopInstallOffset, "release must install Desktop dependencies before packaging");

  for (const forbidden of [
    "renderer-e2e",
    "playwright",
    "chromium",
    "go test",
    "pnpm run test",
    "check_desktop.sh",
    "check_gateway_protocol_contract.sh",
  ]) {
    assert.doesNotMatch(releaseWorkflow, new RegExp(forbidden, "i"));
  }
});
