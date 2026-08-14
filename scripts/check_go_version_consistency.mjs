#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readText(root, path) {
  return readFileSync(join(root, path), "utf8");
}

function canonicalGoVersion(root) {
  const match = readText(root, "go.mod").match(/^go ([0-9]+\.[0-9]+\.[0-9]+)$/mu);
  if (!match) {
    throw new Error("go.mod must declare an exact patch-level Go version");
  }
  return match[1];
}

function validateWorkflow(errors, root, path) {
  const source = readText(root, path);
  const setupCount = [...source.matchAll(/uses:\s*actions\/setup-go@/gu)].length;
  const versionFileCount = [...source.matchAll(/go-version-file:\s*go\.mod/gu)].length;
  if (setupCount === 0 || versionFileCount !== setupCount) {
    errors.push(`${path}: every setup-go step must use go-version-file: go.mod`);
  }
}

export function validateRepository(root, { checkRuntime = true } = {}) {
  const errors = [];
  const version = canonicalGoVersion(root);

  validateWorkflow(errors, root, ".github/workflows/ci-check.yml");
  validateWorkflow(errors, root, ".github/workflows/release.yml");

  const capabilityCheck = readText(root, "scripts/check_containers_v4_release_capability.sh");
  if (!capabilityCheck.includes(`GOTOOLCHAIN=go${version}+auto`)) {
    errors.push(
      `scripts/check_containers_v4_release_capability.sh: GOTOOLCHAIN must be go${version}+auto`,
    );
  }

  const readmes = readdirSync(root)
    .filter((name) => /^README(?:\.[A-Za-z]{2}(?:-[A-Za-z]{2})?)?\.md$/u.test(name))
    .sort();
  for (const path of readmes) {
    const source = readText(root, path);
    if (!source.includes(`Go-${version}-00ADD8`)) {
      errors.push(`${path}: Go badge must declare ${version}`);
    }
    if (!source.includes(`Go \`${version}\``)) {
      errors.push(`${path}: Go prerequisite must declare ${version}`);
    }
  }

  if (checkRuntime) {
    const actual = execFileSync("go", ["env", "GOVERSION"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    if (actual !== `go${version}`) {
      errors.push(`runtime: expected go${version}, got ${actual}`);
    }
  }

  return { errors, version };
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { errors, version } = validateRepository(repoRoot, {
    checkRuntime: !process.argv.includes("--source-only"),
  });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[ERROR] ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`[INFO] Go ${version} sources and runtime are consistent`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
