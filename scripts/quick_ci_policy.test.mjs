import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci-check.yml", import.meta.url), "utf8");
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
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
  const gate = readFileSync(new URL("./check_quick_ci.sh", import.meta.url), "utf8");
  assert.match(gate, /git diff-tree --check --root -r --no-commit-id HEAD/);
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
