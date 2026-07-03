#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_redevplugin_release_artifacts.sh --artifact-dir <dir> [--skip-cosign] [--write-marker <file>]
  ./scripts/check_redevplugin_release_artifacts.sh --self-test

Verifies downloaded ReDevPlugin release artifacts before Redeven consumes them:
  - SHA256SUMS covers every ReDevPlugin tarball and redevplugin-release-stress.json.
  - Each covered artifact and SHA256SUMS has .sig and .bundle evidence.
  - Cosign verifies keyless signatures unless --skip-cosign is used.
  - Release stress evidence is a release-mode pass with required counters.
  - Each tarball contains a valid release-manifest.json, internal SHA256SUMS,
    compatibility.json, and redevplugin-runtime binary.

Set REDEVPLUGIN_COSIGN_CERT_IDENTITY_REGEXP to override the expected GitHub
Actions keyless signing identity regexp. The default is the ReDevPlugin tagged
release workflow identity.
USAGE
}

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)

ARTIFACT_DIR=""
MARKER_PATH=""
SKIP_COSIGN=0
SELF_TEST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      if [[ $# -lt 2 ]]; then
        echo "--artifact-dir requires a path" >&2
        usage >&2
        exit 2
      fi
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --write-marker)
      if [[ $# -lt 2 ]]; then
        echo "--write-marker requires a path" >&2
        usage >&2
        exit 2
      fi
      MARKER_PATH="$2"
      shift 2
      ;;
    --skip-cosign)
      SKIP_COSIGN=1
      shift
      ;;
    --self-test)
      SELF_TEST=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unexpected argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$SELF_TEST" -eq 1 ]]; then
  if [[ -n "$ARTIFACT_DIR" ]]; then
    echo "--self-test cannot be combined with --artifact-dir" >&2
    exit 2
  fi
  if [[ -n "$MARKER_PATH" ]]; then
    echo "--self-test cannot be combined with --write-marker" >&2
    exit 2
  fi
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  artifact_dir="$tmpdir/artifacts"
  bundle_dir="$tmpdir/bundle"
  mkdir -p "$artifact_dir" "$bundle_dir/bin" "$bundle_dir/contracts/spec/plugin"
  printf 'fake runtime\n' >"$bundle_dir/bin/redevplugin-runtime"
  printf 'fake cli\n' >"$bundle_dir/bin/redevplugin"
  chmod +x "$bundle_dir/bin/redevplugin-runtime" "$bundle_dir/bin/redevplugin"
  printf '{}\n' >"$bundle_dir/contracts/spec/plugin/release-manifest-v1.schema.json"
  cat >"$bundle_dir/compatibility.json" <<'JSON'
{
  "schema_version": "redevplugin.compatibility.v1",
  "matrix": {
    "redevplugin_go_version": "v0.0.0-test",
    "redevplugin_ui_version": "v0.0.0-test",
    "redevplugin_runtime_version": "v0.0.0-test",
    "plugin_host_protocol_version": "plugin-host-v1",
    "rust_ipc_version": "rust-ipc-v1",
    "wasm_abi_version": "redevplugin-wasm-worker-v1",
    "manifest_schema_version": "manifest-v1",
    "package_signature_schema_version": "package-signature-v1",
    "token_ticket_schema_version": "token-ticket-v1",
    "bridge_schema_version": "bridge-v1",
    "target_classifier_version": "target-classifier-v1",
    "network_grant_schema_version": "network-grant-v1",
    "plugin_platform_openapi_version": "plugin-platform-v1",
    "compatibility_schema_version": "compatibility-manifest-v1",
    "worker_invocation_schema_version": "worker-invocation-v1",
    "error_codes_schema_version": "error-codes-v1"
  },
  "contracts": [
    {
      "id": "release-manifest-schema",
      "path": "spec/plugin/release-manifest-v1.schema.json",
      "version": "release-manifest-v1",
      "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    }
  ]
}
JSON
  SELF_TEST_BUNDLE_DIR="$bundle_dir" node <<'NODE'
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = process.env.SELF_TEST_BUNDLE_DIR;
const files = [];
walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(root, "release-manifest.json"), `${JSON.stringify({
  schema_version: "redevplugin.release_manifest.v1",
  version: "v0.0.0-test",
  runtime_target: "test-linux-amd64",
  generated_at: "2026-07-03T00:00:00Z",
  files,
}, null, 2)}\n`);
writeFileSync(join(root, "SHA256SUMS"), files.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n");

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const rel = relative(root, path).replaceAll("\\", "/");
    if (rel === "release-manifest.json" || rel === "SHA256SUMS") {
      continue;
    }
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    files.push({
      path: rel,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      size: stat.size,
    });
  }
}
NODE
  tar -czf "$artifact_dir/redevplugin-v0.0.0-test-linux-amd64.tar.gz" -C "$bundle_dir" .
  cat >"$artifact_dir/redevplugin-release-stress.json" <<'JSON'
{
  "ok": true,
  "mode": "release",
  "stress_categories": ["stream_backpressure", "connectivity_classifier", "runtime_revoke_ack", "storage_quota", "csp_report_flood"],
  "stress_evidence": [
    {"category":"stream_backpressure","counters":{"workers":1,"backpressure_denials":1,"core_operation_checks":1}},
    {"category":"connectivity_classifier","counters":{"minted_grants":1,"stale_grant_denials":1,"blocked_resolved_ips":1,"connector_policy_count":1,"http_redirects_not_followed":1,"dns_rebinding_denials":1,"http_proxy_env_ignored":1,"http_connect_denials":1,"alt_svc_headers_dropped":1,"proxy_auth_headers_dropped":1,"udp_round_trips":1,"udp_source_mismatch_dropped":1,"udp_rate_limit_denials":1}},
    {"category":"runtime_revoke_ack","counters":{"attempts":1,"p95_ms":1,"max_ms":1,"threshold_ms":500,"hard_timeout_ms":2000,"closed_actor":1,"closed_socket":1,"closed_stream":1,"closed_storage":1}},
    {"category":"storage_quota","counters":{"writes":1,"quota_denials":1,"imported":1,"usage_bytes":1,"file_quota_denials":1,"file_usage_files":1,"file_quota_files":1,"sqlite_quota_denials":2,"sqlite_rollback_checks":1,"sqlite_page_count":1,"sqlite_sidecar_files":4,"sqlite_sidecar_bytes":1,"sqlite_sparse_logical_bytes":1}},
    {"category":"csp_report_flood","counters":{"attempts":2,"accepted_reports":1,"rate_limited_reports":1,"diagnostic_events":1,"audit_events":0,"unique_sandbox_origins":1,"unique_active_fingerprints":1}}
  ],
  "steps": [
    {"name":"stress_evidence","status":0,"duration_ms":1},
    {"name":"release_bundle","status":0,"duration_ms":1}
  ]
}
JSON
  (
    cd "$artifact_dir"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum redevplugin-v0.0.0-test-linux-amd64.tar.gz redevplugin-release-stress.json >SHA256SUMS
    else
      shasum -a 256 redevplugin-v0.0.0-test-linux-amd64.tar.gz redevplugin-release-stress.json | awk '{ print $1 "  " $2 }' >SHA256SUMS
    fi
    for file in redevplugin-v0.0.0-test-linux-amd64.tar.gz redevplugin-release-stress.json SHA256SUMS; do
      printf 'fixture signature\n' >"${file}.sig"
      printf 'fixture bundle\n' >"${file}.bundle"
    done
  )
  marker_path="$artifact_dir/.redevplugin-release-artifacts-verified.json"
  "$0" --artifact-dir "$artifact_dir" --skip-cosign --write-marker "$marker_path"
  if [[ ! -s "$marker_path" ]]; then
    echo "self-test expected verification marker to be written" >&2
    exit 1
  fi
  bad_artifact_dir="$tmpdir/bad-artifacts"
  cp -R "$artifact_dir" "$bad_artifact_dir"
  BAD_STRESS_FILE="$bad_artifact_dir/redevplugin-release-stress.json" node <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const path = process.env.BAD_STRESS_FILE;
const summary = JSON.parse(readFileSync(path, "utf8"));
const evidence = summary.stress_evidence.find((entry) => entry.category === "runtime_revoke_ack");
evidence.counters.p95_ms = evidence.counters.threshold_ms + 1;
writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
NODE
  (
    cd "$bad_artifact_dir"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum redevplugin-v0.0.0-test-linux-amd64.tar.gz redevplugin-release-stress.json >SHA256SUMS
    else
      shasum -a 256 redevplugin-v0.0.0-test-linux-amd64.tar.gz redevplugin-release-stress.json | awk '{ print $1 "  " $2 }' >SHA256SUMS
    fi
  )
  if "$0" --artifact-dir "$bad_artifact_dir" --skip-cosign >/dev/null 2>&1; then
    echo "self-test expected tampered stress summary to fail" >&2
    exit 1
  fi
  exit 0
fi

if [[ -z "$ARTIFACT_DIR" || ! -d "$ARTIFACT_DIR" ]]; then
  usage >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to verify ReDevPlugin release artifacts" >&2
  exit 1
fi

ARTIFACT_DIR=$(cd -- "$ARTIFACT_DIR" >/dev/null 2>&1 && pwd)
export ARTIFACT_DIR
export SKIP_COSIGN
export MARKER_PATH
export REDEVPLUGIN_COSIGN_CERT_IDENTITY_REGEXP="${REDEVPLUGIN_COSIGN_CERT_IDENTITY_REGEXP:-^https://github.com/floegence/redevplugin/.github/workflows/release.yml@refs/tags/v.*$}"
export REDEVPLUGIN_COSIGN_OIDC_ISSUER="${REDEVPLUGIN_COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

node <<'NODE'
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, relative } = require("node:path");

const artifactDir = process.env.ARTIFACT_DIR;
const skipCosign = process.env.SKIP_COSIGN === "1";
const sumsPath = join(artifactDir, "SHA256SUMS");
const stressPath = join(artifactDir, "redevplugin-release-stress.json");

requireFile(sumsPath, "SHA256SUMS");
requireFile(stressPath, "redevplugin-release-stress.json");

const sums = parseSums(sumsPath);
const coveredPaths = new Set(sums.map((entry) => entry.path));
const tarballs = readdirSync(artifactDir).filter((name) => name.endsWith(".tar.gz"));

if (tarballs.length === 0) {
  fail("artifact directory must contain at least one ReDevPlugin tarball");
}
if (!coveredPaths.has("redevplugin-release-stress.json")) {
  fail("SHA256SUMS must cover redevplugin-release-stress.json");
}
for (const tarball of tarballs) {
  if (!coveredPaths.has(tarball)) {
    fail(`runtime tarball is not covered by SHA256SUMS: ${tarball}`);
  }
}
for (const entry of sums) {
  requireFile(join(artifactDir, entry.path), entry.path);
  verifyFileHash(join(artifactDir, entry.path), entry.sha256, entry.path);
  requireSignatureEvidence(entry.path);
  verifyCosign(entry.path);
}
requireSignatureEvidence("SHA256SUMS");
verifyCosign("SHA256SUMS");
verifyStressSummary(stressPath);
for (const tarball of tarballs) {
  verifyTarball(tarball);
}

console.log(`ReDevPlugin release artifacts verified: ${artifactDir}`);

function parseSums(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean);
  if (lines.length === 0) {
    fail("SHA256SUMS is empty");
  }
  const entries = [];
  const seen = new Set();
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/u);
    if (!match) {
      fail(`SHA256SUMS line ${index + 1} must be '<sha256>  <path>' with lowercase hex`);
    }
    const [, sha256, rel] = match;
    assertSafePath(rel, `SHA256SUMS line ${index + 1}`);
    if (seen.has(rel)) {
      fail(`SHA256SUMS contains duplicate path ${rel}`);
    }
    seen.add(rel);
    entries.push({ sha256, path: rel });
  }
  return entries;
}

function verifyTarball(tarballName) {
  const tmp = mkdtempSync(join(tmpdir(), "redeven-redevplugin-artifact-"));
  try {
    execFileSync("tar", ["-xzf", join(artifactDir, tarballName), "-C", tmp], { stdio: "pipe" });
    const releaseManifest = readJSON(join(tmp, "release-manifest.json"));
    assertObject(releaseManifest, `${tarballName}: release-manifest.json`);
    if (releaseManifest.schema_version !== "redevplugin.release_manifest.v1") {
      fail(`${tarballName}: release manifest schema_version mismatch`);
    }
    const version = requireString(releaseManifest.version, `${tarballName}: release manifest version`);
    if (releaseManifest.runtime_target !== null && typeof releaseManifest.runtime_target !== "string") {
      fail(`${tarballName}: release manifest runtime_target must be string or null`);
    }
    if (!Number.isFinite(Date.parse(releaseManifest.generated_at))) {
      fail(`${tarballName}: release manifest generated_at must be a date-time`);
    }
    if (!Array.isArray(releaseManifest.files) || releaseManifest.files.length === 0) {
      fail(`${tarballName}: release manifest files must be non-empty`);
    }
    const manifestFiles = releaseManifest.files.map((file, index) => {
      assertObject(file, `${tarballName}: release manifest files[${index}]`);
      assertSafePath(requireString(file.path, `${tarballName}: release manifest files[${index}].path`), `${tarballName}: release manifest files[${index}].path`);
      assertHex(requireString(file.sha256, `${tarballName}: release manifest files[${index}].sha256`), `${tarballName}: release manifest files[${index}].sha256`);
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        fail(`${tarballName}: release manifest files[${index}].size must be a non-negative safe integer`);
      }
      return { path: file.path, sha256: file.sha256, size: file.size };
    }).sort(compareManifestFile);
    const actualFiles = listFiles(tmp).sort(compareManifestFile);
    assertDeepEqual(actualFiles, manifestFiles, `${tarballName}: release manifest file list`);
    const expectedInternalSums = manifestFiles.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n";
    const actualInternalSums = readFileSync(join(tmp, "SHA256SUMS"), "utf8");
    if (actualInternalSums !== expectedInternalSums) {
      fail(`${tarballName}: internal SHA256SUMS must match release manifest files`);
    }
    verifyCompatibility(tmp, version, tarballName);
    requireFile(join(tmp, "bin/redevplugin-runtime"), `${tarballName}: bin/redevplugin-runtime`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function verifyCompatibility(root, version, tarballName) {
  const compatibility = readJSON(join(root, "compatibility.json"));
  assertObject(compatibility, `${tarballName}: compatibility.json`);
  if (compatibility.schema_version !== "redevplugin.compatibility.v1") {
    fail(`${tarballName}: compatibility schema_version mismatch`);
  }
  const matrix = assertObject(compatibility.matrix, `${tarballName}: compatibility matrix`);
  for (const key of ["redevplugin_go_version", "redevplugin_ui_version", "redevplugin_runtime_version"]) {
    if (matrix[key] !== version) {
      fail(`${tarballName}: compatibility matrix ${key} must equal ${version}`);
    }
  }
  if (!Array.isArray(compatibility.contracts) || compatibility.contracts.length === 0) {
    fail(`${tarballName}: compatibility contracts must be non-empty`);
  }
  const ids = new Set(compatibility.contracts.map((contract) => contract && contract.id));
  if (!ids.has("release-manifest-schema")) {
    fail(`${tarballName}: compatibility contracts must include release-manifest-schema`);
  }
}

function listFiles(root) {
  const files = [];
  walk(root);
  return files;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const rel = relative(root, path).replaceAll("\\", "/");
      if (rel === "release-manifest.json" || rel === "SHA256SUMS") {
        continue;
      }
      const linkStat = lstatSync(path);
      if (linkStat.isSymbolicLink()) {
        fail(`release bundle must not contain symlink ${rel}`);
      }
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stat.isFile()) {
        fail(`release bundle entry must be a regular file: ${rel}`);
      }
      files.push({
        path: rel,
        sha256: fileHash(path),
        size: stat.size,
      });
    }
  }
}

function verifyStressSummary(path) {
  const summary = readJSON(path);
  assertObject(summary, "release stress summary");
  if (summary.ok !== true) {
    fail("release stress summary ok must be true");
  }
  if (summary.mode !== "release") {
    fail(`release stress summary mode must be "release"; got ${JSON.stringify(summary.mode)}`);
  }
  const categories = new Set(requireArray(summary.stress_categories, "stress_categories"));
  for (const category of ["stream_backpressure", "connectivity_classifier", "runtime_revoke_ack", "storage_quota", "csp_report_flood"]) {
    if (!categories.has(category)) {
      fail(`stress_categories missing ${category}`);
    }
  }
  const evidenceByCategory = new Map();
  for (const evidence of requireArray(summary.stress_evidence, "stress_evidence")) {
    assertObject(evidence, "stress evidence entry");
    const category = requireString(evidence.category, "stress evidence category");
    if (evidenceByCategory.has(category)) {
      fail(`duplicate stress evidence category ${category}`);
    }
    evidenceByCategory.set(category, evidence);
  }
  for (const stepName of ["stress_evidence", "release_bundle"]) {
    const step = requireArray(summary.steps, "steps").find((candidate) => candidate && candidate.name === stepName);
    if (!step || step.status !== 0) {
      fail(`release stress step ${stepName} must have status 0`);
    }
  }
  const workers = requireAtLeast(evidenceByCategory, "stream_backpressure", "workers", 1);
  const backpressureDenials = requireAtLeast(evidenceByCategory, "stream_backpressure", "backpressure_denials", 1);
  if (backpressureDenials < workers) {
    fail("stream_backpressure backpressure_denials must cover workers");
  }
  requireAtLeast(evidenceByCategory, "stream_backpressure", "core_operation_checks", 1);
  for (const counter of [
    "minted_grants",
    "stale_grant_denials",
    "blocked_resolved_ips",
    "connector_policy_count",
    "http_redirects_not_followed",
    "dns_rebinding_denials",
    "http_proxy_env_ignored",
    "http_connect_denials",
    "alt_svc_headers_dropped",
    "proxy_auth_headers_dropped",
    "udp_round_trips",
    "udp_source_mismatch_dropped",
    "udp_rate_limit_denials",
  ]) {
    requireAtLeast(evidenceByCategory, "connectivity_classifier", counter, 1);
  }
  requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "attempts", 1);
  const p95Ms = requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "p95_ms", 0);
  const maxMs = requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "max_ms", 0);
  const thresholdMs = requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "threshold_ms", 1);
  const hardTimeoutMs = requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "hard_timeout_ms", 1);
  if (p95Ms > thresholdMs) {
    fail(`runtime_revoke_ack p95_ms ${p95Ms} exceeds threshold_ms ${thresholdMs}`);
  }
  if (maxMs >= hardTimeoutMs) {
    fail(`runtime_revoke_ack max_ms ${maxMs} must be below hard_timeout_ms ${hardTimeoutMs}`);
  }
  for (const counter of ["closed_actor", "closed_socket", "closed_stream", "closed_storage"]) {
    requireAtLeast(evidenceByCategory, "runtime_revoke_ack", counter, 1);
  }
  const writes = requireAtLeast(evidenceByCategory, "storage_quota", "writes", 1);
  requireAtLeast(evidenceByCategory, "storage_quota", "quota_denials", 1);
  const imported = requireAtLeast(evidenceByCategory, "storage_quota", "imported", 1);
  if (imported !== writes) {
    fail("storage_quota imported must equal writes");
  }
  for (const counter of [
    "usage_bytes",
    "file_quota_denials",
    "file_usage_files",
    "file_quota_files",
    "sqlite_rollback_checks",
    "sqlite_page_count",
    "sqlite_sidecar_files",
    "sqlite_sidecar_bytes",
    "sqlite_sparse_logical_bytes",
  ]) {
    requireAtLeast(evidenceByCategory, "storage_quota", counter, 1);
  }
  requireAtLeast(evidenceByCategory, "storage_quota", "sqlite_quota_denials", 2);
  const cspAttempts = requireAtLeast(evidenceByCategory, "csp_report_flood", "attempts", 1);
  const acceptedReports = requireAtLeast(evidenceByCategory, "csp_report_flood", "accepted_reports", 1);
  const rateLimitedReports = requireAtLeast(evidenceByCategory, "csp_report_flood", "rate_limited_reports", 1);
  if (acceptedReports + rateLimitedReports !== cspAttempts) {
    fail("csp_report_flood accepted + rate_limited must equal attempts");
  }
  const diagnostics = requireAtLeast(evidenceByCategory, "csp_report_flood", "diagnostic_events", 1);
  if (diagnostics !== acceptedReports) {
    fail("csp_report_flood diagnostic_events must equal accepted_reports");
  }
  if (counter(evidenceByCategory, "csp_report_flood", "audit_events") !== 0) {
    fail("csp_report_flood audit_events must be 0");
  }
  if (counter(evidenceByCategory, "csp_report_flood", "unique_sandbox_origins") !== 1) {
    fail("csp_report_flood must report exactly one sandbox origin");
  }
  if (counter(evidenceByCategory, "csp_report_flood", "unique_active_fingerprints") !== 1) {
    fail("csp_report_flood must report exactly one active fingerprint");
  }
}

function verifyCosign(rel) {
  if (skipCosign) {
    return;
  }
  try {
    execFileSync("cosign", [
      "verify-blob",
      "--bundle", join(artifactDir, `${rel}.bundle`),
      "--signature", join(artifactDir, `${rel}.sig`),
      "--certificate-identity-regexp", process.env.REDEVPLUGIN_COSIGN_CERT_IDENTITY_REGEXP,
      "--certificate-oidc-issuer", process.env.REDEVPLUGIN_COSIGN_OIDC_ISSUER,
      join(artifactDir, rel),
    ], { stdio: "inherit" });
  } catch (error) {
    if (error.code === "ENOENT") {
      fail("cosign is required unless --skip-cosign is passed");
    }
    throw error;
  }
}

function requireSignatureEvidence(rel) {
  requireFile(join(artifactDir, `${rel}.sig`), `${rel}.sig`);
  requireFile(join(artifactDir, `${rel}.bundle`), `${rel}.bundle`);
}

function requireAtLeast(evidenceByCategory, category, name, minimum) {
  const value = counter(evidenceByCategory, category, name);
  if (value < minimum) {
    fail(`${category}.${name} = ${value}, want >= ${minimum}`);
  }
  return value;
}

function counter(evidenceByCategory, category, name) {
  const evidence = evidenceByCategory.get(category);
  if (!evidence) {
    fail(`missing stress evidence category ${category}`);
  }
  const value = assertObject(evidence.counters, `${category}.counters`)[name];
  if (!Number.isInteger(value)) {
    fail(`${category}.counters.${name} must be an integer`);
  }
  return value;
}

function compareManifestFile(a, b) {
  return a.path.localeCompare(b.path);
}

function verifyFileHash(path, expected, label) {
  const actual = fileHash(path);
  if (actual !== expected) {
    fail(`checksum mismatch for ${label}: got ${actual}, want ${expected}`);
  }
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`failed to read JSON ${path}: ${error.message}`);
  }
}

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`required artifact missing: ${label}`);
  }
}

function assertObject(value, label) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function assertHex(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be lowercase SHA-256 hex`);
  }
}

function assertSafePath(rel, label) {
  if (!/^[A-Za-z0-9._/@+-]+$/u.test(rel) || rel.startsWith("/") || rel.includes("..") || rel.includes("\\")) {
    fail(`${label} has unsafe path ${JSON.stringify(rel)}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch`);
  }
}

function fail(message) {
  console.error(`[redevplugin-artifacts] ${message}`);
  process.exit(1);
}
NODE

if [[ -n "$MARKER_PATH" ]]; then
  marker_dir=$(dirname -- "$MARKER_PATH")
  mkdir -p "$marker_dir"
  node <<'NODE'
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const artifactDir = process.env.ARTIFACT_DIR;
const markerPath = process.env.MARKER_PATH;
const sumsPath = join(artifactDir, "SHA256SUMS");
const stressPath = join(artifactDir, "redevplugin-release-stress.json");
const tarballs = readdirSync(artifactDir)
  .filter((name) => /^redevplugin-.+\.tar\.gz$/u.test(name))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => ({
    name,
    sha256: fileHash(join(artifactDir, name)),
  }));

mkdirSync(dirname(markerPath), { recursive: true });
writeFileSync(markerPath, `${JSON.stringify({
  schema_version: "redeven.redevplugin_artifact_verification.v1",
  sha256sums_sha256: fileHash(sumsPath),
  stress_summary_sha256: fileHash(stressPath),
  tarballs,
}, null, 2)}\n`);

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
NODE
  echo "ReDevPlugin release artifact verification marker written: $MARKER_PATH"
fi
