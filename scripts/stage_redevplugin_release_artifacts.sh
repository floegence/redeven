#!/usr/bin/env bash
set -euo pipefail

RELEASE_REPO="floegence/redevplugin"
RELEASE_TAG="v0.5.1"
RELEASE_VERSION="0.5.1"
RELEASE_SOURCE_COMMIT="3febcc59bbdb2118a4f105781b4c743bc11ba09f"
MARKER_SCHEMA="redeven.redevplugin_artifact_verification.v4"
MARKER_BASENAME=".redevplugin-release-artifacts-verified.json"
NOTICE_BASENAME="REDEVPLUGIN_THIRD_PARTY_NOTICES.md"

RELEASE_ASSETS=(
  "SHA256SUMS"
  "SHA256SUMS.bundle"
  "SHA256SUMS.sig"
  "redevplugin-a2-acceptance.json"
  "redevplugin-a2-acceptance.json.bundle"
  "redevplugin-a2-acceptance.json.sig"
  "redevplugin-a2-supported.png"
  "redevplugin-a2-supported.png.bundle"
  "redevplugin-a2-supported.png.sig"
  "redevplugin-a2-unsupported.png"
  "redevplugin-a2-unsupported.png.bundle"
  "redevplugin-a2-unsupported.png.sig"
  "redevplugin-release-stress.json"
  "redevplugin-release-stress.json.bundle"
  "redevplugin-release-stress.json.sig"
  "redevplugin-v0.5.1-aarch64-apple-darwin.tar.gz"
  "redevplugin-v0.5.1-aarch64-apple-darwin.tar.gz.bundle"
  "redevplugin-v0.5.1-aarch64-apple-darwin.tar.gz.sig"
  "redevplugin-v0.5.1-aarch64-unknown-linux-gnu.tar.gz"
  "redevplugin-v0.5.1-aarch64-unknown-linux-gnu.tar.gz.bundle"
  "redevplugin-v0.5.1-aarch64-unknown-linux-gnu.tar.gz.sig"
  "redevplugin-v0.5.1-x86_64-apple-darwin.tar.gz"
  "redevplugin-v0.5.1-x86_64-apple-darwin.tar.gz.bundle"
  "redevplugin-v0.5.1-x86_64-apple-darwin.tar.gz.sig"
  "redevplugin-v0.5.1-x86_64-unknown-linux-gnu.tar.gz"
  "redevplugin-v0.5.1-x86_64-unknown-linux-gnu.tar.gz.bundle"
  "redevplugin-v0.5.1-x86_64-unknown-linux-gnu.tar.gz.sig"
)

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/stage_redevplugin_release_artifacts.sh --dest-dir <dir>
  ./scripts/stage_redevplugin_release_artifacts.sh --dest-dir <dir> --redeven-goos <goos> --redeven-goarch <goarch> --runtime-out <file> [--marker-out <file>]
  ./scripts/stage_redevplugin_release_artifacts.sh --self-test

Downloads the closed 27-file ReDevPlugin v0.5.1 release from
floegence/redevplugin, verifies its keyless release evidence, writes a v4
verification marker, and optionally extracts one of the four supported runtime
targets for a Redeven bundle. Production staging accepts no local source,
repository override, signature bypass, version override, or raw runtime target.
USAGE
}

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)

DEST_DIR=""
REDEVEN_GOOS=""
REDEVEN_GOARCH=""
RUNTIME_OUT=""
MARKER_OUT=""
SELF_TEST=0
SELF_TEST_LINUX_AMD64_RUNTIME_SHA256=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest-dir)
      if [[ $# -lt 2 ]]; then
        echo "--dest-dir requires a directory" >&2
        usage >&2
        exit 2
      fi
      DEST_DIR="$2"
      shift 2
      ;;
    --redeven-goos)
      if [[ $# -lt 2 ]]; then
        echo "--redeven-goos requires a GOOS value" >&2
        usage >&2
        exit 2
      fi
      REDEVEN_GOOS="$2"
      shift 2
      ;;
    --redeven-goarch)
      if [[ $# -lt 2 ]]; then
        echo "--redeven-goarch requires a GOARCH value" >&2
        usage >&2
        exit 2
      fi
      REDEVEN_GOARCH="$2"
      shift 2
      ;;
    --runtime-out)
      if [[ $# -lt 2 ]]; then
        echo "--runtime-out requires an output file" >&2
        usage >&2
        exit 2
      fi
      RUNTIME_OUT="$2"
      shift 2
      ;;
    --marker-out)
      if [[ $# -lt 2 ]]; then
        echo "--marker-out requires an output file" >&2
        usage >&2
        exit 2
      fi
      MARKER_OUT="$2"
      shift 2
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

die() {
  echo "[redevplugin-stage] $*" >&2
  exit 1
}

log() {
  echo "[INFO] $*"
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    die "$command_name is required"
  fi
}

hash_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{ print $1 }'
    return
  fi
  shasum -a 256 "$path" | awk '{ print $1 }'
}

resolve_redevplugin_build_triple() {
  local goos="$1"
  local goarch="$2"

  case "${goos}/${goarch}" in
    darwin/amd64)
      printf 'x86_64-apple-darwin\n'
      ;;
    darwin/arm64)
      printf 'aarch64-apple-darwin\n'
      ;;
    linux/amd64)
      printf 'x86_64-unknown-linux-gnu\n'
      ;;
    linux/arm64)
      printf 'aarch64-unknown-linux-gnu\n'
      ;;
    *)
      die "unsupported Redeven target for ReDevPlugin v0.5.1: ${goos}/${goarch}"
      ;;
  esac
}

canonicalize_dest_dir() {
  local dest="$1"
  DEST_INPUT="$dest" ROOT_DIR="$ROOT_DIR" node <<'NODE'
const { existsSync, lstatSync, mkdirSync, realpathSync } = require("node:fs");
const { basename, dirname, join, resolve } = require("node:path");

const requested = resolve(process.env.DEST_INPUT);
if (basename(requested) !== "redevplugin-release") {
  fail("destination basename must be redevplugin-release");
}
const parent = dirname(requested);
if (parent === "/" || parent === resolve(process.env.ROOT_DIR)) {
  fail("destination parent is not an allowed staging parent");
}
mkdirSync(parent, { recursive: true, mode: 0o755 });
const canonicalParent = realpathSync(parent);
const canonical = join(canonicalParent, "redevplugin-release");
if (existsSync(canonical) || lstatExists(canonical)) {
  fail("destination already exists; verified staging never replaces an existing directory");
}
process.stdout.write(`${canonical}\n`);

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}
function fail(message) {
  console.error(`[redevplugin-stage] ${message}`);
  process.exit(1);
}
NODE
}

publish_file() {
  local source="$1"
  local destination="$2"
  local executable="${3:-0}"
  local destination_dir destination_name temporary

  destination_dir=$(dirname -- "$destination")
  destination_name=$(basename -- "$destination")
  mkdir -p "$destination_dir"
  destination_dir=$(cd -- "$destination_dir" >/dev/null 2>&1 && pwd -P)
  if [[ -L "$destination_dir/$destination_name" || -d "$destination_dir/$destination_name" ]]; then
    die "refusing to replace non-regular output: $destination"
  fi
  temporary=$(mktemp "$destination_dir/.${destination_name}.publish.XXXXXX")
  cp "$source" "$temporary"
  if [[ "$executable" == "1" ]]; then
    chmod 0755 "$temporary"
  else
    chmod 0644 "$temporary"
  fi
  "$SCRIPT_DIR/safe_extract_tar.py" \
    --replace-file "$temporary" \
    --dest "$destination_dir/$destination_name"
}

assert_exact_release_assets() {
  local dir="$1"
  local expected
  expected=$(printf '%s\n' "${RELEASE_ASSETS[@]}")
  RELEASE_ASSET_DIR="$dir" EXPECTED_RELEASE_ASSETS="$expected" node <<'NODE'
const { lstatSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const root = process.env.RELEASE_ASSET_DIR;
const expected = process.env.EXPECTED_RELEASE_ASSETS.split("\n").filter(Boolean).sort();
const actual = readdirSync(root).sort();
if (expected.length !== 27) {
  fail(`internal release inventory must contain exactly 27 files, got ${expected.length}`);
}
for (const name of actual) {
  if (!lstatSync(join(root, name)).isFile()) {
    fail(`release staging directory contains a non-file entry: ${name}`);
  }
}
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((name) => !actualSet.has(name));
  const unexpected = actual.filter((name) => !expectedSet.has(name));
  fail(`release asset inventory mismatch; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`);
}

function fail(message) {
  console.error(`[redevplugin-stage] ${message}`);
  process.exit(1);
}
NODE
}

download_release_artifacts() {
  local dest="$1"
  local args=(release download "$RELEASE_TAG" --repo "$RELEASE_REPO" --dir "$dest")
  local asset

  require_command gh
  for asset in "${RELEASE_ASSETS[@]}"; do
    args+=(--pattern "$asset")
  done
  gh "${args[@]}"
  assert_exact_release_assets "$dest"
}

verify_staged_artifacts() {
  local dest="$1"
  local marker="$dest/$MARKER_BASENAME"

  "$SCRIPT_DIR/check_redevplugin_release_artifacts.sh" \
    --artifact-dir "$dest" \
    --tag "$RELEASE_TAG" \
    --write-marker "$marker"
  validate_verifier_marker "$marker"
  "$SCRIPT_DIR/check_redevplugin_consumption_gate.sh" --scan-root "$dest"
}

validate_verifier_marker() {
  local marker="$1"
  MARKER_PATH="$marker" \
    EXPECTED_MARKER_SCHEMA="$MARKER_SCHEMA" \
    EXPECTED_RELEASE_TAG="$RELEASE_TAG" \
    EXPECTED_RELEASE_VERSION="$RELEASE_VERSION" \
    EXPECTED_SOURCE_COMMIT="$RELEASE_SOURCE_COMMIT" \
    SELF_TEST_LINUX_AMD64_RUNTIME_SHA256="$SELF_TEST_LINUX_AMD64_RUNTIME_SHA256" \
    node <<'NODE'
const { readFileSync } = require("node:fs");

const marker = JSON.parse(readFileSync(process.env.MARKER_PATH, "utf8"));
assertExactKeys(marker, [
  "schema_version", "release_tag", "release_version", "source_commit",
  "sha256sums_sha256", "compatibility_sha256", "contract_registry_sha256",
  "npm_package", "worker_sdk", "performance_evidence", "evidence", "signing", "targets",
], "marker");
assertEqual(marker.schema_version, process.env.EXPECTED_MARKER_SCHEMA, "marker schema_version");
assertEqual(marker.release_tag, process.env.EXPECTED_RELEASE_TAG, "marker release_tag");
assertEqual(marker.release_version, process.env.EXPECTED_RELEASE_VERSION, "marker release_version");
assertEqual(marker.source_commit, process.env.EXPECTED_SOURCE_COMMIT, "marker source_commit");
assertSHA256(marker.sha256sums_sha256, "marker sha256sums_sha256");
assertSHA256(marker.compatibility_sha256, "marker compatibility_sha256");
assertSHA256(marker.contract_registry_sha256, "marker contract_registry_sha256");

assertExactKeys(marker.npm_package, ["name", "version", "path", "sha256", "integrity", "size"], "npm_package");
assertEqual(marker.npm_package.name, "@floegence/redevplugin-ui", "npm_package.name");
assertEqual(marker.npm_package.version, "0.5.1", "npm_package.version");
assertEqual(marker.npm_package.path, "npm/floegence-redevplugin-ui-0.5.1.tgz", "npm_package.path");
assertSHA256(marker.npm_package.sha256, "npm_package.sha256");
if (typeof marker.npm_package.integrity !== "string" || !marker.npm_package.integrity.startsWith("sha512-")) {
  fail("npm_package.integrity must be sha512 SRI");
}
assertSize(marker.npm_package.size, "npm_package.size");

assertExactKeys(marker.worker_sdk, ["name", "version", "path", "sha256", "size"], "worker_sdk");
assertEqual(marker.worker_sdk.name, "redevplugin-worker-sdk", "worker_sdk.name");
assertEqual(marker.worker_sdk.version, "0.5.1", "worker_sdk.version");
assertEqual(marker.worker_sdk.path, "sdk/redevplugin-worker-sdk-0.5.1.crate", "worker_sdk.path");
assertSHA256(marker.worker_sdk.sha256, "worker_sdk.sha256");
assertSize(marker.worker_sdk.size, "worker_sdk.size");

assertFileRecord(marker.performance_evidence, "performance_evidence");
assertEqual(marker.performance_evidence.path, "performance-evidence.json", "performance_evidence.path");
assertExactKeys(marker.evidence, ["stress", "a2_report", "a2_supported", "a2_unsupported"], "evidence");
const evidencePaths = {
  stress: "redevplugin-release-stress.json",
  a2_report: "redevplugin-a2-acceptance.json",
  a2_supported: "redevplugin-a2-supported.png",
  a2_unsupported: "redevplugin-a2-unsupported.png",
};
for (const [name, path] of Object.entries(evidencePaths)) {
  assertFileRecord(marker.evidence[name], `evidence.${name}`);
  assertEqual(marker.evidence[name].path, path, `evidence.${name}.path`);
}

assertExactKeys(marker.signing, ["certificate_identity", "oidc_issuer"], "signing");
assertEqual(
  marker.signing.certificate_identity,
  "https://github.com/floegence/redevplugin/.github/workflows/release.yml@refs/tags/v0.5.1",
  "signing.certificate_identity",
);
assertEqual(marker.signing.oidc_issuer, "https://token.actions.githubusercontent.com", "signing.oidc_issuer");

const expectedTargets = [
  ["aarch64-apple-darwin", "darwin/arm64", "fea17883ff27e943eeebc8bf9a68bd3d8c535b95d278fb18da0c3ec3d165dcca"],
  ["aarch64-unknown-linux-gnu", "linux/arm64", "95cd87a998d8ae5c6ea3451551e72c69b8f5e27040b1016fcd39333e2b251b45"],
  ["x86_64-apple-darwin", "darwin/amd64", "eca4f841c60a3e2cb4e76c51567ed7d1cab60a16396db6cbdbaf3d1cc9559841"],
  [
    "x86_64-unknown-linux-gnu",
    "linux/amd64",
    process.env.SELF_TEST_LINUX_AMD64_RUNTIME_SHA256
      || "4f9ccbe61463fa7dc0053086dca128743b493b74f5b4535994d6dbccde55aef4",
  ],
];
if (!Array.isArray(marker.targets) || marker.targets.length !== expectedTargets.length) {
  fail(`marker targets must contain exactly ${expectedTargets.length} entries`);
}
const targets = [...marker.targets].sort((left, right) => left.build_triple.localeCompare(right.build_triple));
for (const [index, [buildTriple, runtimeTarget, runtimeSHA256]] of expectedTargets.entries()) {
  const target = targets[index];
  assertExactKeys(target, [
    "build_triple", "runtime_target", "tarball", "release_manifest_sha256", "runtime", "third_party_notices",
  ], `targets[${index}]`);
  assertEqual(target.build_triple, buildTriple, `targets[${index}].build_triple`);
  assertEqual(target.runtime_target, runtimeTarget, `targets[${index}].runtime_target`);
  assertSHA256(target.release_manifest_sha256, `targets[${index}].release_manifest_sha256`);
  assertExactKeys(target.tarball, ["name", "sha256", "size"], `targets[${index}].tarball`);
  assertEqual(target.tarball.name, `redevplugin-v0.5.1-${buildTriple}.tar.gz`, `targets[${index}].tarball.name`);
  assertSHA256(target.tarball.sha256, `targets[${index}].tarball.sha256`);
  assertSize(target.tarball.size, `targets[${index}].tarball.size`);
  assertFileRecord(target.runtime, `targets[${index}].runtime`);
  assertEqual(target.runtime.path, "bin/redevplugin-runtime", `targets[${index}].runtime.path`);
  assertEqual(target.runtime.sha256, runtimeSHA256, `targets[${index}].runtime.sha256`);
  assertFileRecord(target.third_party_notices, `targets[${index}].third_party_notices`);
  assertEqual(target.third_party_notices.path, "THIRD_PARTY_NOTICES.md", `targets[${index}].third_party_notices.path`);
}

function assertFileRecord(value, label) {
  assertExactKeys(value, ["path", "sha256", "size"], label);
  if (typeof value.path !== "string" || value.path.length === 0) fail(`${label}.path must be non-empty`);
  assertSHA256(value.sha256, `${label}.sha256`);
  assertSize(value.size, `${label}.size`);
}
function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} keys mismatch`);
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} mismatch: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function assertSHA256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail(`${label} must be lowercase SHA-256 hex`);
}
function assertSize(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
}
function fail(message) {
  console.error(`[redevplugin-stage] ${message}`);
  process.exit(1);
}
NODE
}

read_marker_target() {
  local marker="$1"
  local runtime_target="$2"
  MARKER_PATH="$marker" EXPECTED_RUNTIME_TARGET="$runtime_target" node <<'NODE'
const { readFileSync } = require("node:fs");
const marker = JSON.parse(readFileSync(process.env.MARKER_PATH, "utf8"));
const matches = marker.targets.filter((target) => target.runtime_target === process.env.EXPECTED_RUNTIME_TARGET);
if (matches.length !== 1) {
  console.error(`[redevplugin-stage] marker must contain exactly one target for ${process.env.EXPECTED_RUNTIME_TARGET}`);
  process.exit(1);
}
const target = matches[0];
process.stdout.write([
  target.tarball.name,
  target.tarball.sha256,
  target.tarball.size,
  target.release_manifest_sha256,
  target.runtime.path,
  target.runtime.sha256,
  target.third_party_notices.path,
  target.third_party_notices.sha256,
].join("\t") + "\n");
NODE
}

extract_runtime_binary() {
  local dest="$1"
  local goos="$2"
  local goarch="$3"
  local runtime_out="$4"
  local runtime_target="${goos}/${goarch}"
  local build_triple marker metadata
  local tarball_name tarball_sha256 tarball_size manifest_sha256 runtime_path runtime_sha256 notice_path notice_sha256
  local tarball extract_parent extract_root bundle_root runtime_source notice_source runtime_dir

  build_triple=$(resolve_redevplugin_build_triple "$goos" "$goarch")
  marker="$dest/$MARKER_BASENAME"
  validate_verifier_marker "$marker"
  metadata=$(read_marker_target "$marker" "$runtime_target")
  IFS=$'\t' read -r tarball_name tarball_sha256 tarball_size manifest_sha256 runtime_path runtime_sha256 notice_path notice_sha256 <<<"$metadata"

  if [[ "$tarball_name" != "redevplugin-${RELEASE_TAG}-${build_triple}.tar.gz" ]]; then
    die "marker target tarball mismatch for ${runtime_target}: $tarball_name"
  fi
  tarball="$dest/$tarball_name"
  if [[ ! -f "$tarball" ]]; then
    die "verified ReDevPlugin runtime tarball not found for ${runtime_target}: $tarball"
  fi
  if [[ "$(hash_file "$tarball")" != "$tarball_sha256" ]]; then
    die "verified ReDevPlugin runtime tarball changed after verification: $tarball"
  fi

  require_command python3
  extract_parent=$(mktemp -d)
  extract_root="$extract_parent/payload"
  if ! "$SCRIPT_DIR/safe_extract_tar.py" \
    --archive "$tarball" \
    --dest "$extract_root" \
    --expected-root "redevplugin-${RELEASE_TAG}-${build_triple}" \
    --expected-sha256 "$tarball_sha256" \
    --expected-size "$tarball_size" \
    --max-files 4096 \
    --max-total-bytes 536870912
  then
    rm -rf "$extract_parent"
    die "verified runtime tarball failed controlled extraction for ${runtime_target}"
  fi
  bundle_root="$extract_root/redevplugin-${RELEASE_TAG}-${build_triple}"
  if [[ ! -d "$bundle_root" ]]; then
    rm -rf "$extract_parent"
    die "verified runtime tarball must contain the exact ReDevPlugin v0.5.1 bundle root"
  fi
  if [[ "$(hash_file "$bundle_root/release-manifest.json")" != "$manifest_sha256" ]]; then
    rm -rf "$extract_parent"
    die "release manifest changed after verification for ${runtime_target}"
  fi

  runtime_source="$bundle_root/$runtime_path"
  notice_source="$bundle_root/$notice_path"
  if [[ ! -f "$runtime_source" || "$(hash_file "$runtime_source")" != "$runtime_sha256" ]]; then
    rm -rf "$extract_parent"
    die "runtime binary does not match the verified ${runtime_target} marker target"
  fi
  if [[ ! -f "$notice_source" || "$(hash_file "$notice_source")" != "$notice_sha256" ]]; then
    rm -rf "$extract_parent"
    die "third-party notices do not match the verified ${runtime_target} marker target"
  fi

  runtime_dir=$(dirname -- "$runtime_out")
  mkdir -p "$runtime_dir"
  publish_file "$runtime_source" "$runtime_out" 1
  publish_file "$notice_source" "$runtime_dir/$NOTICE_BASENAME"
  publish_file "$marker" "$runtime_dir/$MARKER_BASENAME"
  if [[ -n "$MARKER_OUT" ]]; then
    publish_file "$marker" "$MARKER_OUT"
  fi
  rm -rf "$extract_parent"
  log "ReDevPlugin ${RELEASE_TAG} runtime staged for ${runtime_target}: $runtime_out"
}

run_stage() {
  local canonical_dest staging_parent staging_dir
  if [[ -z "$DEST_DIR" ]]; then
    usage >&2
    exit 2
  fi
  if [[ -n "$REDEVEN_GOOS$REDEVEN_GOARCH$RUNTIME_OUT" ]]; then
    if [[ -z "$REDEVEN_GOOS" || -z "$REDEVEN_GOARCH" || -z "$RUNTIME_OUT" ]]; then
      die "--redeven-goos, --redeven-goarch, and --runtime-out must be provided together"
    fi
    resolve_redevplugin_build_triple "$REDEVEN_GOOS" "$REDEVEN_GOARCH" >/dev/null
  fi

  canonical_dest=$(canonicalize_dest_dir "$DEST_DIR")
  staging_parent=$(dirname -- "$canonical_dest")
  staging_dir=$(mktemp -d "$staging_parent/.redevplugin-release.stage.XXXXXX")
  if ! download_release_artifacts "$staging_dir" || ! verify_staged_artifacts "$staging_dir"; then
    rm -rf "$staging_dir"
    die "ReDevPlugin release staging failed before publication"
  fi
  if ! "$SCRIPT_DIR/safe_extract_tar.py" --publish-dir "$staging_dir" --dest "$canonical_dest"; then
    rm -rf "$staging_dir"
    die "could not atomically publish verified ReDevPlugin release artifacts"
  fi
  DEST_DIR="$canonical_dest"

  if [[ -n "$RUNTIME_OUT" ]]; then
    extract_runtime_binary "$DEST_DIR" "$REDEVEN_GOOS" "$REDEVEN_GOARCH" "$RUNTIME_OUT"
    "$SCRIPT_DIR/check_redevplugin_consumption_gate.sh" \
      --scan-root "$(dirname -- "$RUNTIME_OUT")" \
      --runtime-target "${REDEVEN_GOOS}/${REDEVEN_GOARCH}"
  elif [[ -n "$MARKER_OUT" ]]; then
    publish_file "$DEST_DIR/$MARKER_BASENAME" "$MARKER_OUT"
  fi

  log "ReDevPlugin ${RELEASE_TAG} release artifacts staged: $DEST_DIR"
}

write_self_test_marker() {
  local marker="$1"
  local tarball="$2"
  local runtime="$3"
  local manifest="$4"
  local notices="$5"
  MARKER_PATH="$marker" \
    TARBALL_SHA256="$(hash_file "$tarball")" \
    TARBALL_SIZE="$(wc -c <"$tarball" | tr -d ' ')" \
    RUNTIME_SHA256="$(hash_file "$runtime")" \
    RUNTIME_SIZE="$(wc -c <"$runtime" | tr -d ' ')" \
    MANIFEST_SHA256="$(hash_file "$manifest")" \
    NOTICE_SHA256="$(hash_file "$notices")" \
    NOTICE_SIZE="$(wc -c <"$notices" | tr -d ' ')" \
    node <<'NODE'
const { writeFileSync } = require("node:fs");
const sha = (char) => char.repeat(64);
const targetSpecs = [
  ["aarch64-apple-darwin", "darwin/arm64", "fea17883ff27e943eeebc8bf9a68bd3d8c535b95d278fb18da0c3ec3d165dcca"],
  ["aarch64-unknown-linux-gnu", "linux/arm64", "95cd87a998d8ae5c6ea3451551e72c69b8f5e27040b1016fcd39333e2b251b45"],
  ["x86_64-apple-darwin", "darwin/amd64", "eca4f841c60a3e2cb4e76c51567ed7d1cab60a16396db6cbdbaf3d1cc9559841"],
  ["x86_64-unknown-linux-gnu", "linux/amd64", process.env.RUNTIME_SHA256],
];
const targets = targetSpecs.map(([buildTriple, runtimeTarget, runtimeSHA256]) => ({
  build_triple: buildTriple,
  runtime_target: runtimeTarget,
  tarball: {
    name: `redevplugin-v0.5.1-${buildTriple}.tar.gz`,
    sha256: runtimeTarget === "linux/amd64" ? process.env.TARBALL_SHA256 : sha("a"),
    size: runtimeTarget === "linux/amd64" ? Number(process.env.TARBALL_SIZE) : 1,
  },
  release_manifest_sha256: runtimeTarget === "linux/amd64" ? process.env.MANIFEST_SHA256 : sha("b"),
  runtime: {
    path: "bin/redevplugin-runtime",
    sha256: runtimeSHA256,
    size: runtimeTarget === "linux/amd64" ? Number(process.env.RUNTIME_SIZE) : 1,
  },
  third_party_notices: {
    path: "THIRD_PARTY_NOTICES.md",
    sha256: runtimeTarget === "linux/amd64" ? process.env.NOTICE_SHA256 : sha("c"),
    size: runtimeTarget === "linux/amd64" ? Number(process.env.NOTICE_SIZE) : 1,
  },
}));
writeFileSync(process.env.MARKER_PATH, `${JSON.stringify({
  schema_version: "redeven.redevplugin_artifact_verification.v4",
  release_tag: "v0.5.1",
  release_version: "0.5.1",
  source_commit: "3febcc59bbdb2118a4f105781b4c743bc11ba09f",
  sha256sums_sha256: sha("d"),
  compatibility_sha256: sha("e"),
  contract_registry_sha256: sha("f"),
  npm_package: {
    name: "@floegence/redevplugin-ui",
    version: "0.5.1",
    path: "npm/floegence-redevplugin-ui-0.5.1.tgz",
    sha256: sha("1"),
    integrity: "sha512-self-test",
    size: 1,
  },
  worker_sdk: {
    name: "redevplugin-worker-sdk",
    version: "0.5.1",
    path: "sdk/redevplugin-worker-sdk-0.5.1.crate",
    sha256: sha("2"),
    size: 1,
  },
  performance_evidence: { path: "performance-evidence.json", sha256: sha("3"), size: 1 },
  evidence: {
    stress: { path: "redevplugin-release-stress.json", sha256: sha("4"), size: 1 },
    a2_report: { path: "redevplugin-a2-acceptance.json", sha256: sha("5"), size: 1 },
    a2_supported: { path: "redevplugin-a2-supported.png", sha256: sha("6"), size: 1 },
    a2_unsupported: { path: "redevplugin-a2-unsupported.png", sha256: sha("7"), size: 1 },
  },
  signing: {
    certificate_identity: "https://github.com/floegence/redevplugin/.github/workflows/release.yml@refs/tags/v0.5.1",
    oidc_issuer: "https://token.actions.githubusercontent.com",
  },
  targets,
}, null, 2)}\n`);
NODE
}

run_self_test() {
  local tmpdir assets bundle_root tarball runtime_out marker_out marker
  local forbidden

  if [[ -n "$DEST_DIR$REDEVEN_GOOS$REDEVEN_GOARCH$RUNTIME_OUT$MARKER_OUT" ]]; then
    echo "--self-test cannot be combined with staging arguments" >&2
    exit 2
  fi
  require_command node
  require_command tar

  if [[ "$(resolve_redevplugin_build_triple darwin amd64)" != "x86_64-apple-darwin" ]] ||
     [[ "$(resolve_redevplugin_build_triple darwin arm64)" != "aarch64-apple-darwin" ]] ||
     [[ "$(resolve_redevplugin_build_triple linux amd64)" != "x86_64-unknown-linux-gnu" ]] ||
     [[ "$(resolve_redevplugin_build_triple linux arm64)" != "aarch64-unknown-linux-gnu" ]]; then
    die "self-test target mapping mismatch"
  fi
  if (resolve_redevplugin_build_triple linux riscv64 >/dev/null 2>&1); then
    die "self-test expected unsupported target to fail"
  fi

  for forbidden in --source-dir --skip-cosign --repo --version --runtime-target; do
    if "$0" "$forbidden" invalid >/dev/null 2>&1; then
      die "self-test expected forbidden production option ${forbidden} to fail"
    fi
  done

  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" EXIT
  mkdir -p "$tmpdir/destination-parent"
  canonical_dest=$(canonicalize_dest_dir "$tmpdir/destination-parent/redevplugin-release")
  expected_canonical_dest="$(cd "$tmpdir/destination-parent" >/dev/null 2>&1 && pwd -P)/redevplugin-release"
  if [[ "$canonical_dest" != "$expected_canonical_dest" ]]; then
    die "self-test canonical destination mismatch"
  fi
  mkdir "$canonical_dest"
  if canonicalize_dest_dir "$canonical_dest" >/dev/null 2>&1; then
    die "self-test expected an existing destination to fail"
  fi
  rmdir "$canonical_dest"
  if canonicalize_dest_dir "$tmpdir/destination-parent/not-a-release" >/dev/null 2>&1; then
    die "self-test expected an unsafe destination basename to fail"
  fi
  assets="$tmpdir/assets"
  mkdir -p "$assets"
  for forbidden in "${RELEASE_ASSETS[@]}"; do
    : >"$assets/$forbidden"
  done
  assert_exact_release_assets "$assets"
  : >"$assets/unexpected"
  if (assert_exact_release_assets "$assets" >/dev/null 2>&1); then
    die "self-test expected unexpected release asset to fail"
  fi
  rm "$assets/unexpected"

  bundle_root="$tmpdir/redevplugin-v0.5.1-x86_64-unknown-linux-gnu"
  mkdir -p "$bundle_root/bin"
  printf 'self-test runtime\n' >"$bundle_root/bin/redevplugin-runtime"
  printf 'self-test third-party notices\n' >"$bundle_root/THIRD_PARTY_NOTICES.md"
  printf '{"schema_version":"redevplugin.release_manifest.v4"}\n' >"$bundle_root/release-manifest.json"
  chmod +x "$bundle_root/bin/redevplugin-runtime"
  SELF_TEST_LINUX_AMD64_RUNTIME_SHA256=$(hash_file "$bundle_root/bin/redevplugin-runtime")
  tarball="$assets/redevplugin-v0.5.1-x86_64-unknown-linux-gnu.tar.gz"
  COPYFILE_DISABLE=1 tar --format=ustar -C "$tmpdir" -czf "$tarball" "$(basename -- "$bundle_root")"
  marker="$assets/$MARKER_BASENAME"
  write_self_test_marker \
    "$marker" \
    "$tarball" \
    "$bundle_root/bin/redevplugin-runtime" \
    "$bundle_root/release-manifest.json" \
    "$bundle_root/THIRD_PARTY_NOTICES.md"
  validate_verifier_marker "$marker"

  runtime_out="$tmpdir/runtime/redevplugin-runtime"
  marker_out="$tmpdir/marker/$MARKER_BASENAME"
  MARKER_OUT="$marker_out"
  extract_runtime_binary "$assets" linux amd64 "$runtime_out"
  if [[ ! -x "$runtime_out" ]]; then
    die "self-test expected extracted runtime to be executable"
  fi
  if ! cmp -s "$runtime_out" "$bundle_root/bin/redevplugin-runtime"; then
    die "self-test extracted runtime content mismatch"
  fi
  if ! cmp -s "$(dirname -- "$runtime_out")/$NOTICE_BASENAME" "$bundle_root/THIRD_PARTY_NOTICES.md"; then
    die "self-test extracted notices content mismatch"
  fi
  if [[ ! -s "$(dirname -- "$runtime_out")/$MARKER_BASENAME" || ! -s "$marker_out" ]]; then
    die "self-test expected v4 verifier markers to be copied"
  fi

  log "ReDevPlugin ${RELEASE_TAG} staging self-test passed"
}

if [[ "$SELF_TEST" -eq 1 ]]; then
  run_self_test
  exit 0
fi

run_stage
