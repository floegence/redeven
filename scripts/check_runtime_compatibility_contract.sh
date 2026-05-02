#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
CONTRACT_PATH="$ROOT_DIR/internal/runtimeservice/compatibility_contract.json"

expected_release=""
case "${1:-}" in
  ""|--source-only|--ci)
    expected_release=""
    ;;
  *)
    expected_release="$1"
    ;;
esac

node - "$CONTRACT_PATH" "$ROOT_DIR" "$expected_release" <<'NODE'
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');

const [contractPath, rootDir, expectedRelease] = process.argv.slice(2);
const releaseTagPattern = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const minSameWindowRationaleChars = 80;
const minSameWindowCheckedSurfaces = 5;

function fail(message) {
  console.error(`[runtime-compat] ${message}`);
  process.exit(1);
}

function readJSON(rawPath) {
  try {
    return JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  } catch (error) {
    fail(`failed to read JSON ${rawPath}: ${error.message}`);
  }
}

function trim(value) {
  return String(value ?? '').trim();
}

function requireString(value, field) {
  const clean = trim(value);
  if (clean === '') {
    fail(`${field} is required`);
  }
  return clean;
}

function requireReleaseTag(value, field) {
  const clean = requireString(value, field);
  if (!releaseTagPattern.test(clean)) {
    fail(`${field} must be a release tag such as v1.2.3; got ${JSON.stringify(clean)}`);
  }
  return clean;
}

function gitOutput(args) {
  try {
    return cp.execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function previousReleaseTag(currentRelease) {
  const tags = gitOutput(['tag', '-l', 'v*', '--sort=-version:refname'])
    .split(/\r?\n/u)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.find((tag) => tag !== currentRelease) ?? '';
}

function readPreviousContract(previousTag) {
  if (!previousTag) {
    return null;
  }
  const relativeContractPath = path.relative(rootDir, contractPath).replaceAll(path.sep, '/');
  const raw = gitOutput(['show', `${previousTag}:${relativeContractPath}`]);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`previous compatibility contract at ${previousTag} is invalid JSON: ${error.message}`);
  }
}

const contract = readJSON(contractPath);
const protocolSource = fs.readFileSync(path.join(rootDir, 'internal/runtimeservice/snapshot.go'), 'utf8');
const protocolMatch = protocolSource.match(/const\s+ProtocolVersion\s*=\s*"([^"]+)"/u);
const sourceProtocol = protocolMatch?.[1] ?? '';

if (contract.schema_version !== 1) {
  fail(`schema_version must be 1; got ${JSON.stringify(contract.schema_version)}`);
}
if (sourceProtocol === '') {
  fail('could not resolve ProtocolVersion from internal/runtimeservice/snapshot.go');
}
if (trim(contract.runtime_protocol_version) !== sourceProtocol) {
  fail(`runtime_protocol_version must match ProtocolVersion ${sourceProtocol}; got ${JSON.stringify(contract.runtime_protocol_version)}`);
}
if (!Number.isInteger(contract.compatibility_epoch) || contract.compatibility_epoch <= 0) {
  fail('compatibility_epoch must be a positive integer');
}
requireReleaseTag(contract.minimum_desktop_version, 'minimum_desktop_version');
requireReleaseTag(contract.minimum_runtime_version, 'minimum_runtime_version');

const review = contract.release_review && typeof contract.release_review === 'object'
  ? contract.release_review
  : fail('release_review object is required');
const releaseVersion = requireString(review.release_version, 'release_review.release_version');
requireString(review.reviewed_at, 'release_review.reviewed_at');
requireString(review.review_id, 'release_review.review_id');
requireString(review.summary, 'release_review.summary');
if (!Array.isArray(review.checked_surfaces) || review.checked_surfaces.map(trim).filter(Boolean).length < 3) {
  fail('release_review.checked_surfaces must name at least three reviewed surfaces');
}

if (expectedRelease) {
  requireReleaseTag(expectedRelease, 'expected release');
  if (releaseVersion !== expectedRelease) {
    fail(`release_review.release_version must be ${expectedRelease} for this tag; got ${releaseVersion}`);
  }
  const previousTag = previousReleaseTag(expectedRelease);
  if (previousTag) {
    const previousRelease = requireReleaseTag(review.previous_release, 'release_review.previous_release');
    if (previousRelease !== previousTag) {
      fail(`release_review.previous_release must point at previous tag ${previousTag}; got ${previousRelease}`);
    }
    const previousContract = readPreviousContract(previousTag);
    if (previousContract) {
      const sameCompatibilityWindow = [
        'runtime_protocol_version',
        'compatibility_epoch',
        'minimum_desktop_version',
        'minimum_runtime_version',
      ].every((field) => JSON.stringify(contract[field]) === JSON.stringify(previousContract[field]));
      if (sameCompatibilityWindow) {
        const rationale = trim(review.same_window_rationale);
        const checkedSurfaceCount = review.checked_surfaces.map(trim).filter(Boolean).length;
        if (rationale.length < minSameWindowRationaleChars) {
          fail(`compatibility window is unchanged from ${previousTag}; release_review.same_window_rationale must explain the challenged review in at least ${minSameWindowRationaleChars} characters`);
        }
        if (checkedSurfaceCount < minSameWindowCheckedSurfaces) {
          fail(`compatibility window is unchanged from ${previousTag}; release_review.checked_surfaces must cover at least ${minSameWindowCheckedSurfaces} surfaces`);
        }
      }
    }
  }
} else if (releaseVersion !== 'unreleased' && !releaseTagPattern.test(releaseVersion)) {
  fail(`release_review.release_version must be "unreleased" or a release tag; got ${releaseVersion}`);
}

console.log('[runtime-compat] compatibility contract check passed');
NODE
