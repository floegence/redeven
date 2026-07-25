import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci-check.yml", import.meta.url), "utf8");
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const quickGate = readFileSync(new URL("./check_quick_ci.sh", import.meta.url), "utf8");
const finalGate = readFileSync(new URL("./check_final_integration.sh", import.meta.url), "utf8");
const uiGate = readFileSync(new URL("./check_ui_tests.sh", import.meta.url), "utf8");
const jobsSource = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
const releaseJobsSource = releaseWorkflow.slice(releaseWorkflow.indexOf("\njobs:\n") + "\njobs:\n".length);

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

test("quick gate checks the committed tree instead of trusting a clean checkout", () => {
  assert.match(quickGate, /git diff-tree --check --root -r --no-commit-id HEAD/);
});

test("quick gate remains a closed source-only command set", () => {
  const commands = quickGate
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("echo "));
  const allowed = [
    /^#!\/usr\/bin\/env bash$/,
    /^set -euo pipefail$/,
    /^SCRIPT_DIR=/,
    /^ROOT_DIR=/,
    /^cd "\$ROOT_DIR"$/,
    /^git diff --check$/,
    /^git diff-tree --check --root -r --no-commit-id HEAD$/,
    /^test -z "\$\(gofmt -l \$\(git ls-files '\*\.go'\)\)"$/,
    /^for script in /,
    /^bash -n "\$script"$/,
    /^done$/,
    /^node --check "\$script"$/,
    /^python3 -c /,
    /^node --test scripts\/(quick_ci_policy|actionlint_runner_policy|check_readme_localizations)\.test\.mjs(?: scripts\/actionlint_runner_policy\.test\.mjs)?$/,
    /^node scripts\/check_readme_localizations\.mjs --require-reviewed$/,
    /^\.\/scripts\/okf\/check_source_integrity\.sh$/,
    /^\.\/scripts\/build_okf_bundle\.sh --verify-only$/,
  ];
  for (const command of commands) {
    assert.ok(allowed.some((pattern) => pattern.test(command)), `unexpected quick gate command: ${command}`);
  }

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
    "check_flower_ui",
    "check_desktop",
    "docker",
  ]) {
    assert.doesNotMatch(quickGate, new RegExp(forbidden, "i"));
  }
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
