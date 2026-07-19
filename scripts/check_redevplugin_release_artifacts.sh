#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_redevplugin_release_artifacts.sh --artifact-dir <dir> --tag v0.5.1 [--write-marker <file>]
  ./scripts/check_redevplugin_release_artifacts.sh --self-test

Verifies the exact signed ReDevPlugin v0.5.1 release before Redeven consumes it:
  - the GitHub Release directory is the closed 27-file signed asset set;
  - every signature is bound to the exact v0.5.1 release workflow identity;
  - the four runtime bundles use release manifest v4 and compatibility v6;
  - source commit, runtime target, contracts, npm package, Worker SDK, release
    stress evidence, A2 evidence, notices, and all checksums match the pinned
    v0.5.1 release;
  - an optional deterministic Redeven marker v4 records the verified result.
USAGE
}

ARTIFACT_DIR=""
MARKER_PATH=""
RELEASE_TAG=""
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
    --tag)
      if [[ $# -lt 2 ]]; then
        echo "--tag requires a release tag" >&2
        usage >&2
        exit 2
      fi
      RELEASE_TAG="$2"
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
  if [[ -n "$ARTIFACT_DIR$MARKER_PATH$RELEASE_TAG" ]]; then
    echo "--self-test cannot be combined with other arguments" >&2
    exit 2
  fi
else
  if [[ -z "$ARTIFACT_DIR" || ! -d "$ARTIFACT_DIR" ]]; then
    usage >&2
    exit 2
  fi
  if [[ "$RELEASE_TAG" != "v0.5.1" ]]; then
    echo "ReDevPlugin release tag must be exactly v0.5.1" >&2
    exit 2
  fi
  ARTIFACT_DIR=$(cd -- "$ARTIFACT_DIR" >/dev/null 2>&1 && pwd)
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to verify ReDevPlugin release artifacts" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to safely inspect ReDevPlugin release archives" >&2
  exit 1
fi

SAFE_TAR_EXTRACTOR="$SCRIPT_DIR/safe_extract_tar.py"
export ARTIFACT_DIR MARKER_PATH RELEASE_TAG SELF_TEST SAFE_TAR_EXTRACTOR

node <<'NODE'
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, delimiter, dirname, join, relative, resolve } = require("node:path");

const MARKER_SCHEMA = "redeven.redevplugin_artifact_verification.v4";
const RELEASE_MANIFEST_SCHEMA = "redevplugin.release_manifest.v4";
const COMPATIBILITY_SCHEMA = "redevplugin.compatibility.v6";
const CONTRACT_REGISTRY_SCHEMA = "redevplugin.contract_registry.v1";
const A2_SCHEMA = "redevplugin.a2_acceptance.v1";
const SIGNING_ISSUER = "https://token.actions.githubusercontent.com";
const EXPECTED_CSP = "default-src 'none'; script-src 'nonce-<redacted>'; style-src 'nonce-<redacted>'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src blob:; child-src blob:; form-action 'none'; base-uri 'none'; object-src 'none'; manifest-src 'none'";
const EXPECTED_ALLOW = "accelerometer 'none'; autoplay 'none'; bluetooth 'none'; camera 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; encrypted-media 'none'; fullscreen 'none'; gamepad 'none'; geolocation 'none'; gyroscope 'none'; hid 'none'; magnetometer 'none'; microphone 'none'; midi 'none'; payment 'none'; picture-in-picture 'none'; publickey-credentials-get 'none'; screen-wake-lock 'none'; serial 'none'; usb 'none'; xr-spatial-tracking 'none'";

const contractInventory = Object.freeze([
  Object.freeze({ id: "plugin-platform-openapi", path: "spec/openapi/plugin-platform-v6.yaml", versionKey: "plugin_platform_openapi_version" }),
  Object.freeze({ id: "manifest-schema", path: "spec/plugin/manifest-v5.schema.json", versionKey: "manifest_schema_version" }),
  Object.freeze({ id: "package-signature-schema", path: "spec/plugin/package-signature-v1.schema.json", versionKey: "package_signature_schema_version" }),
  Object.freeze({ id: "release-metadata-schema", path: "spec/plugin/release-metadata-v5.schema.json", versionKey: "release_metadata_schema_version" }),
  Object.freeze({ id: "source-policy-schema", path: "spec/plugin/source-policy-v1.schema.json", versionKey: "source_policy_schema_version" }),
  Object.freeze({ id: "source-revocations-schema", path: "spec/plugin/source-revocations-v1.schema.json", versionKey: "source_revocations_schema_version" }),
  Object.freeze({ id: "token-ticket-schema", path: "spec/plugin/token-ticket-v3.schema.json", versionKey: "token_ticket_schema_version" }),
  Object.freeze({ id: "iframe-bridge-schema", path: "spec/plugin/bridge-v5.schema.json", versionKey: "bridge_schema_version" }),
  Object.freeze({ id: "opaque-surface-document-schema", path: "spec/plugin/opaque-surface-document-v3.schema.json", versionKey: "opaque_surface_document_schema_version" }),
  Object.freeze({ id: "opaque-surface-transport-schema", path: "spec/plugin/opaque-surface-transport-v4.schema.json", versionKey: "opaque_surface_transport_schema_version" }),
  Object.freeze({ id: "compatibility-manifest-schema", path: "spec/plugin/compatibility-manifest-v6.schema.json", versionKey: "compatibility_schema_version" }),
  Object.freeze({ id: "release-manifest-schema", path: "spec/plugin/release-manifest-v4.schema.json", versionKey: "release_manifest_schema_version" }),
  Object.freeze({ id: "worker-invocation-schema", path: "spec/plugin/worker-invocation-v3.schema.json", versionKey: "worker_invocation_schema_version" }),
  Object.freeze({ id: "host-capability-contract-schema", path: "spec/plugin/host-capability-contract-v1.schema.json", versionKey: "host_capability_contract_schema_version" }),
  Object.freeze({ id: "host-capability-pin-schema", path: "spec/plugin/host-capability-pin-v1.schema.json", versionKey: "host_capability_pin_schema_version" }),
  Object.freeze({ id: "host-capability-manifest-schema", path: "spec/plugin/host-capability-manifest-v1.schema.json", versionKey: "host_capability_manifest_schema_version" }),
  Object.freeze({ id: "host-capability-compatibility-schema", path: "spec/plugin/host-capability-compatibility-v1.schema.json", versionKey: "host_capability_compatibility_schema_version" }),
  Object.freeze({ id: "host-capability-signature-schema", path: "spec/plugin/host-capability-signature-v1.schema.json", versionKey: "host_capability_signature_schema_version" }),
  Object.freeze({ id: "host-capability-notices-schema", path: "spec/plugin/host-capability-notices-v1.schema.json", versionKey: "host_capability_notices_schema_version" }),
  Object.freeze({ id: "error-codes-schema", path: "spec/plugin/error-codes-v4.schema.json", versionKey: "error_codes_schema_version" }),
  Object.freeze({ id: "performance-contract", path: "spec/plugin/performance-contract-v1.json", versionKey: "performance_contract_version" }),
  Object.freeze({ id: "performance-evidence-schema", path: "spec/plugin/performance-evidence-v1.schema.json", versionKey: "performance_evidence_schema_version" }),
  Object.freeze({ id: "rust-ipc-schema", path: "spec/plugin/ipc-v4.schema.json", versionKey: "rust_ipc_version" }),
  Object.freeze({ id: "wasm-worker-schema", path: "spec/plugin/wasm-worker-v2.schema.json", versionKey: "wasm_abi_version" }),
  Object.freeze({ id: "network-grant-schema", path: "spec/plugin/network-grant-v2.schema.json", versionKey: "network_grant_schema_version" }),
  Object.freeze({ id: "resource-scope-schema", path: "spec/plugin/resource-scope-v1.schema.json", versionKey: "resource_scope_schema_version" }),
  Object.freeze({ id: "target-classifier-fixture", path: "spec/plugin/target-classifier-v2.json", versionKey: "target_classifier_version" }),
  Object.freeze({ id: "contract-registry", path: "spec/plugin/contract-registry-v1.json", versionKey: "contract_registry_version" }),
]);

const protocolMatrix = Object.freeze({
  plugin_ui_protocol_version: "plugin-ui-v5",
  plugin_host_protocol_version: "plugin-host-v4",
  rust_ipc_version: "rust-ipc-v4",
  wasm_abi_version: "redevplugin-wasm-worker-v2",
  manifest_schema_version: "manifest-v5",
  package_signature_schema_version: "package-signature-v1",
  release_metadata_schema_version: "release-metadata-v5",
  source_policy_schema_version: "source-policy-v1",
  source_revocations_schema_version: "source-revocations-v1",
  token_ticket_schema_version: "token-ticket-v3",
  bridge_schema_version: "bridge-v5",
  opaque_surface_document_schema_version: "opaque-surface-document-v3",
  opaque_surface_transport_schema_version: "opaque-surface-transport-v4",
  target_classifier_version: "target-classifier-v2",
  network_grant_schema_version: "network-grant-v2",
  resource_scope_schema_version: "resource-scope-v1",
  plugin_platform_openapi_version: "plugin-platform-v6",
  compatibility_schema_version: "compatibility-manifest-v6",
  release_manifest_schema_version: "release-manifest-v4",
  worker_invocation_schema_version: "worker-invocation-v3",
  host_capability_contract_schema_version: "host-capability-contract-v1",
  host_capability_pin_schema_version: "host-capability-pin-v1",
  host_capability_manifest_schema_version: "host-capability-manifest-v1",
  host_capability_compatibility_schema_version: "host-capability-compatibility-v1",
  host_capability_signature_schema_version: "host-capability-signature-v1",
  host_capability_notices_schema_version: "host-capability-notices-v1",
  error_codes_schema_version: "error-codes-v4",
  performance_contract_version: "performance-contract-v1",
  performance_evidence_schema_version: "performance-evidence-v1",
  contract_registry_version: "contract-registry-v1",
});

const targetDefinitions = Object.freeze([
  Object.freeze({ buildTriple: "aarch64-apple-darwin", runtimeTarget: "darwin/arm64" }),
  Object.freeze({ buildTriple: "aarch64-unknown-linux-gnu", runtimeTarget: "linux/arm64" }),
  Object.freeze({ buildTriple: "x86_64-apple-darwin", runtimeTarget: "darwin/amd64" }),
  Object.freeze({ buildTriple: "x86_64-unknown-linux-gnu", runtimeTarget: "linux/amd64" }),
]);

const productionPolicy = Object.freeze({
  tag: "v0.5.1",
  version: "0.5.1",
  sourceCommit: "3febcc59bbdb2118a4f105781b4c743bc11ba09f",
  sha256sumsSHA256: "4776bd269a023a3ce4224b2f3598c1feae243b13e98a410e1614cabc87b11936",
  compatibilitySHA256: "e7ef9c519412c97239f8cc41a661334667773793670c742f26c7aed69257a04b",
  contractRegistrySHA256: "86cc5ccce02ef00b6cf8b44af07ad3a82867ee039d8d82ffc704194ee2c62547",
  npmPackage: Object.freeze({
    name: "@floegence/redevplugin-ui",
    version: "0.5.1",
    path: "npm/floegence-redevplugin-ui-0.5.1.tgz",
    sha256: "d906629dccc84bce4e42bf2ce4ca62dc8412d5418686d1a7867bbca36dcf1efa",
    integrity: "sha512-WyRUQ489hkBLGYixXFSSyErIn8MpKpU6spHCYaD3HH6/DH7XYChKXCTznT6y2rV1kB8hDMM3WpYj3GVooa9OPQ==",
    size: 90317,
  }),
  workerSDK: Object.freeze({
    name: "redevplugin-worker-sdk",
    version: "0.5.1",
    path: "sdk/redevplugin-worker-sdk-0.5.1.crate",
    sha256: "2472cf284610a77fb9a6d0222ec676e4f363d06d445d573bd638e4241c5224ea",
    size: 9607,
  }),
  performanceEvidence: Object.freeze({ path: "performance-evidence.json", sha256: "810ab256be5b0b88a05f594370e46d10390789708ef3d2b56428d83d85e6b0e7", size: 16739 }),
  evidence: Object.freeze({
    stress: Object.freeze({ path: "redevplugin-release-stress.json", sha256: "f334cb5f2c5bdc16c7f492f6e4475d9ce573ee29086c8589b6674067c18db742", size: 2682 }),
    a2Report: Object.freeze({ path: "redevplugin-a2-acceptance.json", sha256: "d01675e65459f213b4c74ba526352fbbb6250ebdf680ac8b197cc34a659b5250", size: 5368 }),
    a2Supported: Object.freeze({ path: "redevplugin-a2-supported.png", sha256: "5e5431759cc4445d73934241fe521cbbf4e74897920fd40d394c715696444771", size: 111621 }),
    a2Unsupported: Object.freeze({ path: "redevplugin-a2-unsupported.png", sha256: "893e2b2734c86049c5f7f80a63f7032947ed1049da4180fdad1679b4a0690d27", size: 113811 }),
  }),
  signing: Object.freeze({
    certificateIdentity: "https://github.com/floegence/redevplugin/.github/workflows/release.yml@refs/tags/v0.5.1",
    oidcIssuer: SIGNING_ISSUER,
  }),
  targets: Object.freeze([
    Object.freeze({
      buildTriple: "aarch64-apple-darwin",
      runtimeTarget: "darwin/arm64",
      tarball: Object.freeze({ name: "redevplugin-v0.5.1-aarch64-apple-darwin.tar.gz", sha256: "7be98100880eabf42a26df7ac3d1350fdeafe6c5fb1f8290cd0695fdb91f0df5", size: 17158176 }),
      releaseManifestSHA256: "25b1a842cdd4b88524ae0f47b2c289cadd07d62e0ffab1264a7f4724466ad047",
      runtime: Object.freeze({ path: "bin/redevplugin-runtime", sha256: "fea17883ff27e943eeebc8bf9a68bd3d8c535b95d278fb18da0c3ec3d165dcca", size: 5055296 }),
      thirdPartyNotices: Object.freeze({ path: "THIRD_PARTY_NOTICES.md", sha256: "46753d2c64302bb211fe01865301d140d7d6cb996c5604ba4318fa0b905db530", size: 7936 }),
    }),
    Object.freeze({
      buildTriple: "aarch64-unknown-linux-gnu",
      runtimeTarget: "linux/arm64",
      tarball: Object.freeze({ name: "redevplugin-v0.5.1-aarch64-unknown-linux-gnu.tar.gz", sha256: "f752ef863ae62ec8208a2239d4704b501c099b0ab5f62cf469545079e17e89e0", size: 16671420 }),
      releaseManifestSHA256: "716451d062bcddff3f9897dd1dfec543c670ebb30bf2a72dd8ed086ce4b66e8c",
      runtime: Object.freeze({ path: "bin/redevplugin-runtime", sha256: "95cd87a998d8ae5c6ea3451551e72c69b8f5e27040b1016fcd39333e2b251b45", size: 5859144 }),
      thirdPartyNotices: Object.freeze({ path: "THIRD_PARTY_NOTICES.md", sha256: "46753d2c64302bb211fe01865301d140d7d6cb996c5604ba4318fa0b905db530", size: 7936 }),
    }),
    Object.freeze({
      buildTriple: "x86_64-apple-darwin",
      runtimeTarget: "darwin/amd64",
      tarball: Object.freeze({ name: "redevplugin-v0.5.1-x86_64-apple-darwin.tar.gz", sha256: "54fb9a35b36f4a6a3c1212f834c843b263bf7e710c2d74d025e6ef53780ef670", size: 17963118 }),
      releaseManifestSHA256: "6e0d6a60750bc44854d25c0cbf0e10c7e600349225b9c41c2cbd34d1a74e385d",
      runtime: Object.freeze({ path: "bin/redevplugin-runtime", sha256: "eca4f841c60a3e2cb4e76c51567ed7d1cab60a16396db6cbdbaf3d1cc9559841", size: 5260056 }),
      thirdPartyNotices: Object.freeze({ path: "THIRD_PARTY_NOTICES.md", sha256: "46753d2c64302bb211fe01865301d140d7d6cb996c5604ba4318fa0b905db530", size: 7936 }),
    }),
    Object.freeze({
      buildTriple: "x86_64-unknown-linux-gnu",
      runtimeTarget: "linux/amd64",
      tarball: Object.freeze({ name: "redevplugin-v0.5.1-x86_64-unknown-linux-gnu.tar.gz", sha256: "020cc608fe221402f6f72c2e7408f40d26519a0ad391dfe04867d70bb12697b7", size: 17762212 }),
      releaseManifestSHA256: "0f522390e8a409d50d52bb74a7d39647e0be533e9436940df20d60fe0931d269",
      runtime: Object.freeze({ path: "bin/redevplugin-runtime", sha256: "4f9ccbe61463fa7dc0053086dca128743b493b74f5b4535994d6dbccde55aef4", size: 5910232 }),
      thirdPartyNotices: Object.freeze({ path: "THIRD_PARTY_NOTICES.md", sha256: "46753d2c64302bb211fe01865301d140d7d6cb996c5604ba4318fa0b905db530", size: 7936 }),
    }),
  ]),
});

let selfTestRoot = "";
try {
  if (process.env.SELF_TEST === "1") {
    runSelfTest();
  } else {
    const artifactDir = resolve(process.env.ARTIFACT_DIR);
    const markerPath = process.env.MARKER_PATH ? resolve(process.env.MARKER_PATH) : "";
    if (process.env.RELEASE_TAG !== productionPolicy.tag) {
      throw new Error(`release tag must be exactly ${productionPolicy.tag}`);
    }
    const verifiedTargets = verifyReleaseSet(artifactDir, markerPath, productionPolicy);
    if (markerPath) {
      writeMarker(markerPath, productionPolicy, verifiedTargets);
      console.log(`ReDevPlugin release artifact verification marker written: ${markerPath}`);
    }
    console.log(`ReDevPlugin ${productionPolicy.tag} release artifacts verified: ${artifactDir}`);
  }
} catch (error) {
  console.error(`[redevplugin-artifacts] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (selfTestRoot) rmSync(selfTestRoot, { recursive: true, force: true });
}

function verifyReleaseSet(artifactDir, markerPath, policy) {
  requireDirectory(artifactDir, "artifact directory");
  const sumsPath = join(artifactDir, "SHA256SUMS");
  requireFile(sumsPath, "SHA256SUMS");
  assertFileIdentity(sumsPath, { sha256: policy.sha256sumsSHA256 }, "SHA256SUMS");

  const expectedPayloads = [
    ...policy.targets.map((target) => target.tarball),
    policy.evidence.stress,
    policy.evidence.a2Report,
    policy.evidence.a2Supported,
    policy.evidence.a2Unsupported,
  ];
  const expectedReleaseFiles = ["SHA256SUMS"];
  for (const payload of expectedPayloads) expectedReleaseFiles.push(payload.name || payload.path);
  for (const name of [...expectedReleaseFiles]) expectedReleaseFiles.push(`${name}.sig`, `${name}.bundle`);
  expectedReleaseFiles.sort(compareStrings);

  const ignoredMarker = markerPath && dirname(markerPath) === artifactDir ? basename(markerPath) : "";
  const actualReleaseFiles = readdirSync(artifactDir)
    .filter((name) => name !== ignoredMarker)
    .map((name) => {
      const path = join(artifactDir, name);
      if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
        throw new Error(`release artifact entry must be a regular file: ${name}`);
      }
      return name;
    })
    .sort(compareStrings);
  assertDeepEqual(actualReleaseFiles, expectedReleaseFiles, "GitHub Release closed asset set");

  const sums = parseSums(sumsPath);
  const expectedSums = expectedPayloads.map((payload) => ({
    path: payload.name || payload.path,
    sha256: payload.sha256,
  }));
  assertDeepEqual(sums, expectedSums, "SHA256SUMS entries");

  for (const payload of expectedPayloads) {
    const name = payload.name || payload.path;
    const path = join(artifactDir, name);
    assertFileIdentity(path, payload, name);
    verifyCosign(artifactDir, name, policy.signing);
  }
  verifyCosign(artifactDir, "SHA256SUMS", policy.signing);

  verifyStressSummary(readJSON(join(artifactDir, policy.evidence.stress.path)));
  validateA2Evidence({
    report: readJSON(join(artifactDir, policy.evidence.a2Report.path)),
    supportedScreenshot: readFileSync(join(artifactDir, policy.evidence.a2Supported.path)),
    unsupportedScreenshot: readFileSync(join(artifactDir, policy.evidence.a2Unsupported.path)),
  });

  const verifiedTargets = policy.targets.map((target) => verifyTarball(artifactDir, target, policy));
  assertDeepEqual(
    verifiedTargets.map((target) => target.runtime_target),
    policy.targets.map((target) => target.runtimeTarget),
    "runtime target matrix",
  );
  return verifiedTargets;
}

function parseSums(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean);
  const entries = [];
  const seen = new Set();
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/u);
    if (!match) throw new Error(`SHA256SUMS line ${index + 1} is not canonical`);
    const [, sha256, rel] = match;
    assertSafePath(rel, `SHA256SUMS line ${index + 1}`);
    if (seen.has(rel)) throw new Error(`SHA256SUMS contains duplicate path ${rel}`);
    seen.add(rel);
    entries.push({ path: rel, sha256 });
  }
  if (entries.length === 0) throw new Error("SHA256SUMS is empty");
  return entries;
}

function verifyTarball(artifactDir, target, policy) {
  const tarballPath = join(artifactDir, target.tarball.name);
  const expectedRoot = target.tarball.name.slice(0, -".tar.gz".length);
  const extractParent = mkdtempSync(join(tmpdir(), "redeven-redevplugin-bundle-"));
  const extractRoot = join(extractParent, "payload");
  try {
    execFileSync(process.env.SAFE_TAR_EXTRACTOR, [
      "--archive", tarballPath,
      "--dest", extractRoot,
      "--expected-root", expectedRoot,
      "--expected-sha256", target.tarball.sha256,
      "--expected-size", String(target.tarball.size),
      "--max-files", "4096",
      "--max-total-bytes", String(512 * 1024 * 1024),
    ], { stdio: "pipe" });
    const roots = readdirSync(extractRoot);
    if (roots.length !== 1 || roots[0] !== expectedRoot) {
      throw new Error(`${target.tarball.name}: extracted archive root mismatch`);
    }
    const bundleRoot = join(extractRoot, expectedRoot);
    requireDirectory(bundleRoot, `${target.tarball.name}: bundle root`);
    const releaseManifestPath = join(bundleRoot, "release-manifest.json");
    const releaseManifestBytes = readFileSync(releaseManifestPath);
    assertEqual(sha256(releaseManifestBytes), target.releaseManifestSHA256, `${target.tarball.name}: release manifest sha256`);
    const manifest = parseJSONBytes(releaseManifestBytes, `${target.tarball.name}: release-manifest.json`);
    verifyReleaseManifest(manifest, target, policy, target.tarball.name);

    const actualFiles = listBundleFiles(bundleRoot);
    assertDeepEqual(manifest.files, actualFiles, `${target.tarball.name}: release manifest file list`);
    const expectedInternalSums = manifest.files.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n";
    assertEqual(readFileSync(join(bundleRoot, "SHA256SUMS"), "utf8"), expectedInternalSums, `${target.tarball.name}: internal SHA256SUMS`);

    assertFileIdentity(join(bundleRoot, target.runtime.path), target.runtime, `${target.tarball.name}: runtime`);
    assertFileIdentity(join(bundleRoot, target.thirdPartyNotices.path), target.thirdPartyNotices, `${target.tarball.name}: third-party notices`);
    assertFileIdentity(join(bundleRoot, policy.npmPackage.path), policy.npmPackage, `${target.tarball.name}: npm package`);
    assertEqual(
      `sha512-${createHash("sha512").update(readFileSync(join(bundleRoot, policy.npmPackage.path))).digest("base64")}`,
      policy.npmPackage.integrity,
      `${target.tarball.name}: npm integrity`,
    );
    assertFileIdentity(join(bundleRoot, policy.workerSDK.path), policy.workerSDK, `${target.tarball.name}: Worker SDK`);
    assertFileIdentity(join(bundleRoot, policy.performanceEvidence.path), policy.performanceEvidence, `${target.tarball.name}: performance evidence`);
    requireFile(join(bundleRoot, "bin/redevplugin"), `${target.tarball.name}: ReDevPlugin CLI`);

    const compatibilityPath = join(bundleRoot, "compatibility.json");
    assertFileIdentity(compatibilityPath, { sha256: policy.compatibilitySHA256 }, `${target.tarball.name}: compatibility.json`);
    verifyCompatibility(readJSON(compatibilityPath), bundleRoot, policy, target.tarball.name);
    return targetMarkerRecord(target);
  } finally {
    rmSync(extractParent, { recursive: true, force: true });
  }
}

function verifyReleaseManifest(manifest, target, policy, label) {
  assertObject(manifest, `${label}: release manifest`);
  assertExactKeys(manifest, [
    "schema_version",
    "version",
    "source_commit",
    "runtime_target",
    "generated_at",
    "compatibility_sha256",
    "npm_package",
    "worker_sdk",
    "files",
  ], `${label}: release manifest`);
  assertEqual(manifest.schema_version, RELEASE_MANIFEST_SCHEMA, `${label}: release manifest schema_version`);
  assertEqual(manifest.version, policy.version, `${label}: release manifest version`);
  assertEqual(manifest.source_commit, policy.sourceCommit, `${label}: release manifest source_commit`);
  assertEqual(manifest.runtime_target, target.runtimeTarget, `${label}: release manifest runtime_target`);
  assertRFC3339(manifest.generated_at, `${label}: release manifest generated_at`);
  assertEqual(manifest.compatibility_sha256, policy.compatibilitySHA256, `${label}: compatibility_sha256`);
  assertDeepEqual(manifest.npm_package, policy.npmPackage, `${label}: npm_package metadata`);
  assertDeepEqual(manifest.worker_sdk, policy.workerSDK, `${label}: worker_sdk metadata`);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${label}: release manifest files must be non-empty`);
  }
  const seen = new Set();
  let previous = "";
  for (const [index, file] of manifest.files.entries()) {
    assertObject(file, `${label}: files[${index}]`);
    assertExactKeys(file, ["path", "sha256", "size"], `${label}: files[${index}]`);
    assertSafePath(file.path, `${label}: files[${index}].path`);
    assertSHA256(file.sha256, `${label}: files[${index}].sha256`);
    assertSize(file.size, `${label}: files[${index}].size`, true);
    if (seen.has(file.path)) throw new Error(`${label}: duplicate manifest path ${file.path}`);
    if (previous && previous.localeCompare(file.path) >= 0) throw new Error(`${label}: manifest files are not canonically ordered`);
    seen.add(file.path);
    previous = file.path;
  }
}

function verifyCompatibility(compatibility, bundleRoot, policy, label) {
  assertObject(compatibility, `${label}: compatibility`);
  assertExactKeys(compatibility, ["schema_version", "matrix", "contracts"], `${label}: compatibility`);
  assertEqual(compatibility.schema_version, COMPATIBILITY_SCHEMA, `${label}: compatibility schema_version`);
  const expectedMatrix = expectedCompatibilityMatrix(policy.version);
  assertDeepEqualByKeys(compatibility.matrix, expectedMatrix, `${label}: compatibility matrix`);
  if (!Array.isArray(compatibility.contracts)) throw new Error(`${label}: compatibility contracts must be an array`);
  assertEqual(compatibility.contracts.length, contractInventory.length, `${label}: compatibility contract count`);

  const seenIDs = new Set();
  const seenPaths = new Set();
  for (const [index, expected] of contractInventory.entries()) {
    const contract = compatibility.contracts[index];
    assertObject(contract, `${label}: compatibility contracts[${index}]`);
    assertExactKeys(contract, ["id", "path", "version", "sha256"], `${label}: compatibility contracts[${index}]`);
    assertEqual(contract.id, expected.id, `${label}: contract[${index}].id`);
    assertEqual(contract.path, expected.path, `${label}: contract[${index}].path`);
    assertEqual(contract.version, expectedMatrix[expected.versionKey], `${label}: contract[${index}].version`);
    assertSHA256(contract.sha256, `${label}: contract[${index}].sha256`);
    if (seenIDs.has(contract.id) || seenPaths.has(contract.path)) throw new Error(`${label}: duplicate compatibility contract`);
    seenIDs.add(contract.id);
    seenPaths.add(contract.path);
    assertFileIdentity(join(bundleRoot, "contracts", contract.path), { sha256: contract.sha256 }, `${label}: contract ${contract.id}`);
  }

  const registryPath = join(bundleRoot, "contracts/spec/plugin/contract-registry-v1.json");
  assertFileIdentity(registryPath, { sha256: policy.contractRegistrySHA256 }, `${label}: contract registry`);
  const registry = readJSON(registryPath);
  assertObject(registry, `${label}: contract registry`);
  assertExactKeys(registry, ["schema_version", "matrix", "contracts"], `${label}: contract registry`);
  assertEqual(registry.schema_version, CONTRACT_REGISTRY_SCHEMA, `${label}: contract registry schema_version`);
  assertDeepEqualByKeys(registry.matrix, expectedRegistryMatrix(), `${label}: contract registry matrix`);
  assertDeepEqual(
    registry.contracts,
    contractInventory.map((contract) => ({ id: contract.id, path: contract.path, version_key: contract.versionKey })),
    `${label}: contract registry inventory`,
  );
}

function expectedCompatibilityMatrix(version) {
  return {
    redevplugin_go_version: version,
    redevplugin_ui_version: version,
    redevplugin_runtime_version: version,
    ...protocolMatrix,
  };
}

function expectedRegistryMatrix() {
  return {
    ...protocolMatrix,
    compatibility_manifest_version: COMPATIBILITY_SCHEMA,
  };
}

function listBundleFiles(root) {
  const files = [];
  const directories = new Set();
  walk(root);
  const allowedDirectories = new Set();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      allowedDirectories.add(parts.slice(0, index).join("/"));
    }
  }
  const unexpectedDirectories = [...directories].filter((path) => !allowedDirectories.has(path)).sort(compareStrings);
  if (unexpectedDirectories.length > 0) {
    throw new Error(`bundle contains directories outside the file inventory: ${JSON.stringify(unexpectedDirectories)}`);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));

  function walk(dir) {
    for (const entry of readdirSync(dir).sort(compareStrings)) {
      const path = join(dir, entry);
      const rel = relative(root, path).replaceAll("\\", "/");
      if (rel === "release-manifest.json" || rel === "SHA256SUMS") continue;
      const linkStat = lstatSync(path);
      if (linkStat.isSymbolicLink()) throw new Error(`bundle contains symlink ${rel}`);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        directories.add(rel);
        walk(path);
      } else if (stat.isFile()) {
        files.push({ path: rel, sha256: fileSHA256(path), size: stat.size });
      } else {
        throw new Error(`bundle entry must be a regular file: ${rel}`);
      }
    }
  }
}

function verifyStressSummary(summary) {
  assertObject(summary, "release stress summary");
  if (summary.ok !== true) throw new Error("release stress summary ok must be true");
  assertEqual(summary.mode, "release", "release stress summary mode");
  const requiredCategories = [
    "go_race",
    "stream_backpressure",
    "operation_cancel_ownership",
    "connectivity_classifier",
    "runtime_revoke_ack",
    "storage_quota",
    "browser_harness",
    "runtime_contract",
    "release_bundle",
    "published_release_verifier",
  ];
  assertStringArray(summary.stress_categories, "stress_categories");
  assertDeepEqual(summary.stress_categories, requiredCategories, "stress_categories");

  const evidenceByCategory = new Map();
  if (!Array.isArray(summary.stress_evidence)) throw new Error("stress_evidence must be an array");
  for (const evidence of summary.stress_evidence) {
    assertObject(evidence, "stress evidence entry");
    if (typeof evidence.category !== "string" || evidence.category.length === 0) throw new Error("stress evidence category must be non-empty");
    if (evidenceByCategory.has(evidence.category)) throw new Error(`duplicate stress evidence ${evidence.category}`);
    evidenceByCategory.set(evidence.category, evidence);
  }

  const requiredSteps = [
    "npm_ci",
    "go_race_core",
    "connectivity_stress_evidence",
    "stress_evidence",
    "go_all",
    "browser_harness",
    "runtime_contract",
    "release_bundle",
    "published_release_verifier",
  ];
  if (!Array.isArray(summary.steps)) throw new Error("release stress steps must be an array");
  assertDeepEqual(summary.steps.map((step) => step && step.name), requiredSteps, "release stress step order");
  for (const step of summary.steps) {
    assertObject(step, "release stress step");
    if (step.status !== 0) throw new Error(`release stress step ${step.name} must have status 0`);
    if (!Number.isSafeInteger(step.duration_ms) || step.duration_ms < 0) throw new Error(`release stress step ${step.name} duration_ms is invalid`);
  }

  const workers = requireAtLeast(evidenceByCategory, "stream_backpressure", "workers", 1);
  const backpressureDenials = requireAtLeast(evidenceByCategory, "stream_backpressure", "backpressure_denials", 1);
  if (backpressureDenials < workers) throw new Error("stream_backpressure denials must cover workers");
  requireAtLeast(evidenceByCategory, "stream_backpressure", "core_operation_checks", 1);
  const streamCloseRequests = requireAtLeast(evidenceByCategory, "stream_backpressure", "stream_close_requests", 1);
  const closedStreams = requireAtLeast(evidenceByCategory, "stream_backpressure", "closed_streams", 1);
  assertEqual(closedStreams, streamCloseRequests, "stream_backpressure closed streams");
  assertEqual(requireAtLeast(evidenceByCategory, "stream_backpressure", "post_close_append_denials", 1), closedStreams, "stream_backpressure post-close denials");
  requireAtLeast(evidenceByCategory, "stream_backpressure", "stream_close_status_checked", 1);

  const operations = requireAtLeast(evidenceByCategory, "operation_cancel_ownership", "operations_registered", 2);
  const cancelRequested = requireAtLeast(evidenceByCategory, "operation_cancel_ownership", "cancel_requested_records", 2);
  assertEqual(cancelRequested, operations, "operation cancellation ownership count");
  requireAtLeast(evidenceByCategory, "operation_cancel_ownership", "durable_requests_without_active_lease", 2);
  requireAtLeast(evidenceByCategory, "operation_cancel_ownership", "http_accepted_requests", 1);
  assertEqual(requireAtLeast(evidenceByCategory, "operation_cancel_ownership", "audit_cancel_requested_events", 2), cancelRequested, "operation cancellation audit count");
  assertEqual(counter(evidenceByCategory, "operation_cancel_ownership", "registry_redispatches"), 0, "operation cancellation redispatches");

  for (const name of [
    "minted_grants", "stale_grant_denials", "blocked_resolved_ips", "connector_policy_count",
    "http_redirects_not_followed", "dns_rebinding_denials", "http_proxy_env_ignored", "http_connect_denials",
    "alt_svc_headers_dropped", "proxy_auth_headers_dropped", "http_stream_round_trips", "http_stream_chunks",
    "http_stream_request_denials", "http_stream_response_denials", "http_stream_cancelled_reads",
    "tcp_database_round_trips", "tcp_request_denials", "tcp_response_denials", "tcp_cancelled_reads",
    "udp_round_trips", "udp_source_mismatch_dropped", "udp_rate_limit_denials", "websocket_round_trips",
    "websocket_request_denials", "websocket_response_denials", "websocket_cancelled_reads",
  ]) requireAtLeast(evidenceByCategory, "connectivity_classifier", name, 1);

  requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "attempts", 1);
  const p95 = requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "p95_ms", 0);
  const max = requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "max_ms", 0);
  const threshold = requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "threshold_ms", 1);
  const timeout = requireAtLeast(evidenceByCategory, "runtime_revoke_ack", "hard_timeout_ms", 1);
  if (p95 > threshold) throw new Error("runtime revoke p95 exceeds threshold");
  if (max >= timeout) throw new Error("runtime revoke max must be below hard timeout");
  for (const name of ["closed_socket", "closed_stream", "closed_storage"]) requireAtLeast(evidenceByCategory, "runtime_revoke_ack", name, 1);

  const writes = requireAtLeast(evidenceByCategory, "storage_quota", "writes", 1);
  requireAtLeast(evidenceByCategory, "storage_quota", "quota_denials", 1);
  assertEqual(requireAtLeast(evidenceByCategory, "storage_quota", "imported", 1), writes, "storage imported writes");
  for (const name of [
    "usage_bytes", "file_quota_denials", "file_usage_files", "file_quota_files", "sqlite_rollback_checks",
    "sqlite_page_count", "sqlite_sidecar_bytes", "sqlite_sparse_logical_bytes",
  ]) requireAtLeast(evidenceByCategory, "storage_quota", name, 1);
  requireAtLeast(evidenceByCategory, "storage_quota", "sqlite_quota_denials", 2);
  requireAtLeast(evidenceByCategory, "storage_quota", "sqlite_sidecar_files", 4);
}

function counter(evidenceByCategory, category, name) {
  const evidence = evidenceByCategory.get(category);
  if (!evidence) throw new Error(`missing stress evidence category ${category}`);
  assertObject(evidence.counters, `${category}.counters`);
  const value = evidence.counters[name];
  if (!Number.isSafeInteger(value)) throw new Error(`${category}.${name} must be an integer`);
  return value;
}

function requireAtLeast(evidenceByCategory, category, name, minimum) {
  const value = counter(evidenceByCategory, category, name);
  if (value < minimum) throw new Error(`${category}.${name} must be at least ${minimum}`);
  return value;
}

function validateA2Evidence({ report, supportedScreenshot, unsupportedScreenshot }) {
  const scenarioKeys = [
    "credentialless_scenario", "credentialless", "sandbox", "allow", "referrer_policy", "csp",
    "frame_origin", "opaque_origin", "isolation", "worker_probe", "platform_dynamic_import_gate",
    "parent_credentials_absent", "credential_query_absent", "direct_worker_network_absent",
    "strict_request_allowlist", "websocket_absent", "service_worker_absent", "opening_progress",
    "first_paint_before_lazy_asset", "stream_response_loss_recovered", "real_stream_redeemed",
    "confirmation_disposal_aborted", "server_disposed", "disposed",
  ];
  const isolationKeys = [
    "parent_dom_blocked", "parent_cookie_blocked", "parent_local_storage_blocked",
    "parent_session_storage_blocked", "indexeddb_blocked", "cache_storage_blocked",
    "direct_fetch_blocked", "service_worker_blocked",
  ];
  const workerProbeKeys = [
    "dedicated_worker", "fetch_blocked", "websocket_blocked", "nested_worker_blocked",
    "indexeddb_blocked", "cache_storage_blocked", "broadcast_channel_blocked", "global_postmessage_blocked",
    "navigator_storage_blocked", "eval_blocked", "function_constructor_blocked", "prototype_descriptors_sealed",
    "message_port_prototype_sealed", "prototype_fetch_blocked", "prototype_indexeddb_blocked",
    "prototype_nested_blob_worker_blocked", "all_blocked",
  ];
  const proofKeys = [
    "opaque_origin", "platform_dynamic_import_gate", "parent_credentials_absent", "credential_query_absent",
    "direct_worker_network_absent", "strict_request_allowlist", "websocket_absent", "service_worker_absent",
    "opening_progress", "first_paint_before_lazy_asset", "stream_response_loss_recovered", "real_stream_redeemed",
    "confirmation_disposal_aborted", "server_disposed", "disposed",
  ];
  assertObject(report, "A2 report");
  assertExactKeys(report, ["schema_version", "evidence_source", "scenarios"], "A2 report");
  assertEqual(report.schema_version, A2_SCHEMA, "A2 schema_version");
  assertEqual(report.evidence_source, "go-host-http-adapter-rust-runtime-chromium", "A2 evidence source");
  if (!Array.isArray(report.scenarios) || report.scenarios.length !== 2) throw new Error("A2 report must contain two scenarios");
  const scenarios = new Map(report.scenarios.map((scenario) => [scenario && scenario.credentialless_scenario, scenario]));
  if (scenarios.size !== 2) throw new Error("A2 scenarios must be unique");
  for (const name of ["supported", "unsupported"]) {
    const scenario = scenarios.get(name);
    assertObject(scenario, `A2 ${name}`);
    assertExactKeys(scenario, scenarioKeys, `A2 ${name}`);
    assertEqual(scenario.credentialless, name === "supported", `A2 ${name} credentialless`);
    assertEqual(scenario.sandbox, "allow-scripts", `A2 ${name} sandbox`);
    assertEqual(scenario.allow, EXPECTED_ALLOW, `A2 ${name} allow`);
    assertEqual(scenario.referrer_policy, "no-referrer", `A2 ${name} referrer policy`);
    assertEqual(scenario.csp, EXPECTED_CSP, `A2 ${name} CSP`);
    assertEqual(scenario.frame_origin, "null", `A2 ${name} frame origin`);
    requireTrueFields(scenario, proofKeys, `A2 ${name}`);
    requireExactTrueObject(scenario.isolation, isolationKeys, `A2 ${name}.isolation`);
    requireExactTrueObject(scenario.worker_probe, workerProbeKeys, `A2 ${name}.worker_probe`);
  }
  requirePNG(supportedScreenshot, "A2 supported screenshot");
  requirePNG(unsupportedScreenshot, "A2 unsupported screenshot");
}

function requireTrueFields(value, keys, label) {
  for (const key of keys) if (value[key] !== true) throw new Error(`${label}.${key} must be true`);
}

function requireExactTrueObject(value, keys, label) {
  assertObject(value, label);
  assertExactKeys(value, keys, label);
  requireTrueFields(value, keys, label);
}

function requirePNG(bytes, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`${label} is not a PNG`);
  }
}

function verifyCosign(artifactDir, rel, signing) {
  const signature = join(artifactDir, `${rel}.sig`);
  const bundle = join(artifactDir, `${rel}.bundle`);
  requireFile(signature, `${rel}.sig`);
  requireFile(bundle, `${rel}.bundle`);
  try {
    execFileSync("cosign", [
      "verify-blob",
      "--bundle", bundle,
      "--signature", signature,
      "--certificate-identity", signing.certificateIdentity,
      "--certificate-oidc-issuer", signing.oidcIssuer,
      join(artifactDir, rel),
    ], { stdio: "pipe" });
  } catch (error) {
    if (error && error.code === "ENOENT") throw new Error("cosign is required to verify ReDevPlugin release artifacts");
    throw new Error(`cosign verification failed for ${rel}`);
  }
}

function targetMarkerRecord(target) {
  return {
    build_triple: target.buildTriple,
    runtime_target: target.runtimeTarget,
    tarball: { ...target.tarball },
    release_manifest_sha256: target.releaseManifestSHA256,
    runtime: { ...target.runtime },
    third_party_notices: { ...target.thirdPartyNotices },
  };
}

function markerValue(policy, verifiedTargets) {
  return {
    schema_version: MARKER_SCHEMA,
    release_tag: policy.tag,
    release_version: policy.version,
    source_commit: policy.sourceCommit,
    sha256sums_sha256: policy.sha256sumsSHA256,
    compatibility_sha256: policy.compatibilitySHA256,
    contract_registry_sha256: policy.contractRegistrySHA256,
    npm_package: { ...policy.npmPackage },
    worker_sdk: { ...policy.workerSDK },
    performance_evidence: { ...policy.performanceEvidence },
    evidence: {
      stress: { ...policy.evidence.stress },
      a2_report: { ...policy.evidence.a2Report },
      a2_supported: { ...policy.evidence.a2Supported },
      a2_unsupported: { ...policy.evidence.a2Unsupported },
    },
    signing: {
      certificate_identity: policy.signing.certificateIdentity,
      oidc_issuer: policy.signing.oidcIssuer,
    },
    targets: verifiedTargets,
  };
}

function writeMarker(path, policy, verifiedTargets) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(markerValue(policy, verifiedTargets), null, 2)}\n`);
}

function runSelfTest() {
  selfTestRoot = mkdtempSync(join(tmpdir(), "redeven-redevplugin-verifier-self-test-"));
  const { artifactDir, markerPath, policy, bundleRoots } = createSelfTestFixture(selfTestRoot);
  installFakeCosign(selfTestRoot, policy.signing);
  const verifiedTargets = verifyReleaseSet(artifactDir, markerPath, policy);
  writeMarker(markerPath, policy, verifiedTargets);
  const marker = readJSON(markerPath);
  assertDeepEqual(marker, markerValue(policy, verifiedTargets), "self-test marker v4");
  assertEqual(marker.schema_version, MARKER_SCHEMA, "self-test marker schema");
  assertEqual(marker.targets.length, 4, "self-test marker target count");

  const cosignCalls = readFileSync(join(selfTestRoot, "cosign-calls.log"), "utf8").trim().split("\n").filter(Boolean);
  assertEqual(cosignCalls.length, 9, "self-test cosign verification count");

  const badStress = structuredClone(readJSON(join(artifactDir, policy.evidence.stress.path)));
  badStress.stress_categories.pop();
  expectFailure(() => verifyStressSummary(badStress), "self-test missing stress category");

  const badA2 = structuredClone(readJSON(join(artifactDir, policy.evidence.a2Report.path)));
  badA2.scenarios[0].frame_origin = "https://host.invalid";
  expectFailure(() => validateA2Evidence({
    report: badA2,
    supportedScreenshot: readFileSync(join(artifactDir, policy.evidence.a2Supported.path)),
    unsupportedScreenshot: readFileSync(join(artifactDir, policy.evidence.a2Unsupported.path)),
  }), "self-test non-opaque A2 origin");

  const badCompatibility = structuredClone(readJSON(join(bundleRoots[0], "compatibility.json")));
  badCompatibility.contracts.pop();
  expectFailure(() => verifyCompatibility(badCompatibility, bundleRoots[0], policy, "self-test"), "self-test incomplete compatibility inventory");

  rmSync(join(artifactDir, `${policy.evidence.stress.path}.bundle`));
  expectFailure(() => verifyReleaseSet(artifactDir, markerPath, policy), "self-test missing signed release asset");
  console.log("ReDevPlugin v0.5.1 release artifact verifier self-test passed");
}

function createSelfTestFixture(root) {
  const artifactDir = join(root, "artifacts");
  const bundlesDir = join(root, "bundles");
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(bundlesDir, { recursive: true });
  const version = "0.0.0";
  const tag = "v0.0.0";
  const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
  const compatibilityMatrix = expectedCompatibilityMatrix(version);
  const registry = {
    schema_version: CONTRACT_REGISTRY_SCHEMA,
    matrix: expectedRegistryMatrix(),
    contracts: contractInventory.map((contract) => ({ id: contract.id, path: contract.path, version_key: contract.versionKey })),
  };
  const npmBytes = Buffer.from("self-test npm package\n");
  const workerBytes = Buffer.from("self-test Worker SDK\n");
  const performanceBytes = Buffer.from("self-test performance evidence\n");
  const noticesBytes = Buffer.from("self-test third-party notices\n");
  const npmPackage = {
    name: "@floegence/redevplugin-ui",
    version,
    path: `npm/floegence-redevplugin-ui-${version}.tgz`,
    sha256: sha256(npmBytes),
    integrity: `sha512-${createHash("sha512").update(npmBytes).digest("base64")}`,
    size: npmBytes.length,
  };
  const workerSDK = {
    name: "redevplugin-worker-sdk",
    version,
    path: `sdk/redevplugin-worker-sdk-${version}.crate`,
    sha256: sha256(workerBytes),
    size: workerBytes.length,
  };
  const performanceEvidence = { path: "performance-evidence.json", sha256: sha256(performanceBytes), size: performanceBytes.length };
  const bundleRoots = [];
  const targetRecords = [];
  let compatibilitySHA256 = "";
  let contractRegistrySHA256 = "";

  for (const definition of targetDefinitions) {
    const rootName = `redevplugin-${tag}-${definition.buildTriple}`;
    const bundleRoot = join(bundlesDir, rootName);
    bundleRoots.push(bundleRoot);
    mkdirSync(join(bundleRoot, "bin"), { recursive: true });
    mkdirSync(join(bundleRoot, "contracts"), { recursive: true });
    mkdirSync(join(bundleRoot, "npm"), { recursive: true });
    mkdirSync(join(bundleRoot, "sdk"), { recursive: true });
    const runtimeBytes = Buffer.from(`self-test runtime ${definition.runtimeTarget}\n`);
    writeFileSync(join(bundleRoot, "bin/redevplugin-runtime"), runtimeBytes);
    writeFileSync(join(bundleRoot, "bin/redevplugin"), "self-test CLI\n");
    chmodSync(join(bundleRoot, "bin/redevplugin-runtime"), 0o755);
    chmodSync(join(bundleRoot, "bin/redevplugin"), 0o755);
    writeFileSync(join(bundleRoot, "THIRD_PARTY_NOTICES.md"), noticesBytes);
    writeFileSync(join(bundleRoot, npmPackage.path), npmBytes);
    writeFileSync(join(bundleRoot, workerSDK.path), workerBytes);
    writeFileSync(join(bundleRoot, performanceEvidence.path), performanceBytes);

    for (const contract of contractInventory) {
      if (contract.id === "contract-registry") continue;
      const path = join(bundleRoot, "contracts", contract.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contract.path.endsWith(".yaml") ? "openapi: 3.1.0\n" : `${JSON.stringify({ fixture: contract.id })}\n`);
    }
    const registryPath = join(bundleRoot, "contracts/spec/plugin/contract-registry-v1.json");
    mkdirSync(dirname(registryPath), { recursive: true });
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    const registryHash = fileSHA256(registryPath);
    if (contractRegistrySHA256 && contractRegistrySHA256 !== registryHash) throw new Error("self-test registry bytes differ across targets");
    contractRegistrySHA256 = registryHash;

    const compatibility = {
      schema_version: COMPATIBILITY_SCHEMA,
      matrix: compatibilityMatrix,
      contracts: contractInventory.map((contract) => {
        const path = join(bundleRoot, "contracts", contract.path);
        return { id: contract.id, path: contract.path, version: compatibilityMatrix[contract.versionKey], sha256: fileSHA256(path) };
      }),
    };
    const compatibilityPath = join(bundleRoot, "compatibility.json");
    writeFileSync(compatibilityPath, `${JSON.stringify(compatibility, null, 2)}\n`);
    const compatibilityHash = fileSHA256(compatibilityPath);
    if (compatibilitySHA256 && compatibilitySHA256 !== compatibilityHash) throw new Error("self-test compatibility bytes differ across targets");
    compatibilitySHA256 = compatibilityHash;

    const files = listBundleFiles(bundleRoot);
    const manifest = {
      schema_version: RELEASE_MANIFEST_SCHEMA,
      version,
      source_commit: sourceCommit,
      runtime_target: definition.runtimeTarget,
      generated_at: "2026-07-19T00:00:00Z",
      compatibility_sha256: compatibilitySHA256,
      npm_package: npmPackage,
      worker_sdk: workerSDK,
      files,
    };
    const manifestPath = join(bundleRoot, "release-manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(bundleRoot, "SHA256SUMS"), files.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n");
    const tarballName = `${rootName}.tar.gz`;
    const tarballPath = join(artifactDir, tarballName);
    execFileSync("tar", ["--format=ustar", "-C", bundlesDir, "-czf", tarballPath, rootName], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    const tarballStat = statSync(tarballPath);
    targetRecords.push({
      buildTriple: definition.buildTriple,
      runtimeTarget: definition.runtimeTarget,
      tarball: { name: tarballName, sha256: fileSHA256(tarballPath), size: tarballStat.size },
      releaseManifestSHA256: fileSHA256(manifestPath),
      runtime: { path: "bin/redevplugin-runtime", sha256: sha256(runtimeBytes), size: runtimeBytes.length },
      thirdPartyNotices: { path: "THIRD_PARTY_NOTICES.md", sha256: sha256(noticesBytes), size: noticesBytes.length },
    });
  }

  const stress = selfTestStressSummary();
  const stressPath = join(artifactDir, "redevplugin-release-stress.json");
  writeFileSync(stressPath, `${JSON.stringify(stress, null, 2)}\n`);
  const a2ReportPath = join(artifactDir, "redevplugin-a2-acceptance.json");
  writeFileSync(a2ReportPath, `${JSON.stringify(selfTestA2Report(), null, 2)}\n`);
  const pngBytes = Buffer.from("89504e470d0a1a0a", "hex");
  const supportedPath = join(artifactDir, "redevplugin-a2-supported.png");
  const unsupportedPath = join(artifactDir, "redevplugin-a2-unsupported.png");
  writeFileSync(supportedPath, pngBytes);
  writeFileSync(unsupportedPath, pngBytes);
  const evidence = {
    stress: fileDescriptor(stressPath),
    a2Report: fileDescriptor(a2ReportPath),
    a2Supported: fileDescriptor(supportedPath),
    a2Unsupported: fileDescriptor(unsupportedPath),
  };
  const payloads = [...targetRecords.map((target) => target.tarball), evidence.stress, evidence.a2Report, evidence.a2Supported, evidence.a2Unsupported];
  const sumsPath = join(artifactDir, "SHA256SUMS");
  writeFileSync(sumsPath, payloads.map((payload) => `${payload.sha256}  ${payload.name || payload.path}`).join("\n") + "\n");
  for (const payload of [...payloads.map((payload) => payload.name || payload.path), "SHA256SUMS"]) {
    writeFileSync(join(artifactDir, `${payload}.sig`), "self-test signature\n");
    writeFileSync(join(artifactDir, `${payload}.bundle`), "self-test bundle\n");
  }
  const policy = {
    tag,
    version,
    sourceCommit,
    sha256sumsSHA256: fileSHA256(sumsPath),
    compatibilitySHA256,
    contractRegistrySHA256,
    npmPackage,
    workerSDK,
    performanceEvidence,
    evidence,
    signing: {
      certificateIdentity: `https://github.com/floegence/redevplugin/.github/workflows/release.yml@refs/tags/${tag}`,
      oidcIssuer: SIGNING_ISSUER,
    },
    targets: targetRecords,
  };
  return { artifactDir, markerPath: join(artifactDir, ".redevplugin-release-artifacts-verified.json"), policy, bundleRoots };
}

function fileDescriptor(path) {
  const stat = statSync(path);
  return { path: basename(path), sha256: fileSHA256(path), size: stat.size };
}

function installFakeCosign(root, signing) {
  const binDir = join(root, "bin");
  const commandPath = join(binDir, "cosign");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(commandPath, `#!/usr/bin/env node
const { appendFileSync, existsSync } = require("node:fs");
const args = process.argv.slice(2);
function value(flag) { const index = args.indexOf(flag); return index < 0 ? "" : args[index + 1]; }
if (args[0] !== "verify-blob") process.exit(11);
if (value("--certificate-identity") !== process.env.REDEVPLUGIN_SELF_TEST_COSIGN_IDENTITY) process.exit(12);
if (value("--certificate-oidc-issuer") !== process.env.REDEVPLUGIN_SELF_TEST_COSIGN_ISSUER) process.exit(13);
if (!existsSync(value("--bundle")) || !existsSync(value("--signature")) || !existsSync(args[args.length - 1])) process.exit(14);
appendFileSync(process.env.REDEVPLUGIN_SELF_TEST_COSIGN_LOG, args[args.length - 1] + "\\n");
`);
  chmodSync(commandPath, 0o755);
  process.env.REDEVPLUGIN_SELF_TEST_COSIGN_IDENTITY = signing.certificateIdentity;
  process.env.REDEVPLUGIN_SELF_TEST_COSIGN_ISSUER = signing.oidcIssuer;
  process.env.REDEVPLUGIN_SELF_TEST_COSIGN_LOG = join(root, "cosign-calls.log");
  process.env.PATH = `${binDir}${delimiter}${process.env.PATH || ""}`;
}

function selfTestStressSummary() {
  return {
    ok: true,
    mode: "release",
    stress_categories: [
      "go_race", "stream_backpressure", "operation_cancel_ownership", "connectivity_classifier",
      "runtime_revoke_ack", "storage_quota", "browser_harness", "runtime_contract", "release_bundle",
      "published_release_verifier",
    ],
    stress_evidence: [
      { category: "stream_backpressure", counters: { workers: 1, backpressure_denials: 1, core_operation_checks: 1, stream_close_requests: 1, closed_streams: 1, post_close_append_denials: 1, stream_close_status_checked: 1 } },
      { category: "operation_cancel_ownership", counters: { operations_registered: 2, cancel_requested_records: 2, durable_requests_without_active_lease: 2, http_accepted_requests: 1, audit_cancel_requested_events: 2, registry_redispatches: 0 } },
      { category: "connectivity_classifier", counters: Object.fromEntries([
        "minted_grants", "stale_grant_denials", "blocked_resolved_ips", "connector_policy_count", "http_redirects_not_followed",
        "dns_rebinding_denials", "http_proxy_env_ignored", "http_connect_denials", "alt_svc_headers_dropped",
        "proxy_auth_headers_dropped", "http_stream_round_trips", "http_stream_chunks", "http_stream_request_denials",
        "http_stream_response_denials", "http_stream_cancelled_reads", "tcp_database_round_trips", "tcp_request_denials",
        "tcp_response_denials", "tcp_cancelled_reads", "udp_round_trips", "udp_source_mismatch_dropped", "udp_rate_limit_denials",
        "websocket_round_trips", "websocket_request_denials", "websocket_response_denials", "websocket_cancelled_reads",
      ].map((name) => [name, 1])) },
      { category: "runtime_revoke_ack", counters: { attempts: 1, p95_ms: 1, max_ms: 1, threshold_ms: 500, hard_timeout_ms: 2000, closed_socket: 1, closed_stream: 1, closed_storage: 1 } },
      { category: "storage_quota", counters: { writes: 1, quota_denials: 1, imported: 1, usage_bytes: 1, file_quota_denials: 1, file_usage_files: 1, file_quota_files: 1, sqlite_quota_denials: 2, sqlite_rollback_checks: 1, sqlite_page_count: 1, sqlite_sidecar_files: 4, sqlite_sidecar_bytes: 1, sqlite_sparse_logical_bytes: 1 } },
    ],
    steps: [
      "npm_ci", "go_race_core", "connectivity_stress_evidence", "stress_evidence", "go_all", "browser_harness",
      "runtime_contract", "release_bundle", "published_release_verifier",
    ].map((name) => ({ name, status: 0, duration_ms: 1 })),
  };
}

function selfTestA2Report() {
  const isolation = Object.fromEntries([
    "parent_dom_blocked", "parent_cookie_blocked", "parent_local_storage_blocked", "parent_session_storage_blocked",
    "indexeddb_blocked", "cache_storage_blocked", "direct_fetch_blocked", "service_worker_blocked",
  ].map((key) => [key, true]));
  const workerProbe = Object.fromEntries([
    "dedicated_worker", "fetch_blocked", "websocket_blocked", "nested_worker_blocked", "indexeddb_blocked",
    "cache_storage_blocked", "broadcast_channel_blocked", "global_postmessage_blocked", "navigator_storage_blocked",
    "eval_blocked", "function_constructor_blocked", "prototype_descriptors_sealed", "message_port_prototype_sealed",
    "prototype_fetch_blocked", "prototype_indexeddb_blocked", "prototype_nested_blob_worker_blocked", "all_blocked",
  ].map((key) => [key, true]));
  return {
    schema_version: A2_SCHEMA,
    evidence_source: "go-host-http-adapter-rust-runtime-chromium",
    scenarios: ["supported", "unsupported"].map((name) => ({
      credentialless_scenario: name,
      credentialless: name === "supported",
      sandbox: "allow-scripts",
      allow: EXPECTED_ALLOW,
      referrer_policy: "no-referrer",
      csp: EXPECTED_CSP,
      frame_origin: "null",
      opaque_origin: true,
      isolation,
      worker_probe: workerProbe,
      platform_dynamic_import_gate: true,
      parent_credentials_absent: true,
      credential_query_absent: true,
      direct_worker_network_absent: true,
      strict_request_allowlist: true,
      websocket_absent: true,
      service_worker_absent: true,
      opening_progress: true,
      first_paint_before_lazy_asset: true,
      stream_response_loss_recovered: true,
      real_stream_redeemed: true,
      confirmation_disposal_aborted: true,
      server_disposed: true,
      disposed: true,
    })),
  };
}

function expectFailure(fn, label) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label} did not fail closed`);
}

function readJSON(path) {
  return parseJSONBytes(readFileSync(path), path);
}

function parseJSONBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertFileIdentity(path, expected, label) {
  requireFile(path, label);
  const stat = statSync(path);
  if (Object.hasOwn(expected, "size")) assertEqual(stat.size, expected.size, `${label} size`);
  if (Object.hasOwn(expected, "sha256")) assertEqual(fileSHA256(path), expected.sha256, `${label} sha256`);
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`required artifact missing: ${label}`);
  const linkStat = lstatSync(path);
  if (linkStat.isSymbolicLink() || !statSync(path).isFile()) throw new Error(`${label} must be a regular non-symlink file`);
}

function requireDirectory(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing`);
  const linkStat = lstatSync(path);
  if (linkStat.isSymbolicLink() || !statSync(path).isDirectory()) throw new Error(`${label} must be a non-symlink directory`);
}

function assertObject(value, label) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareStrings);
  const want = [...expected].sort(compareStrings);
  assertDeepEqual(actual, want, `${label} keys`);
}

function assertDeepEqualByKeys(actual, expected, label) {
  assertObject(actual, label);
  assertExactKeys(actual, Object.keys(expected), label);
  for (const [key, value] of Object.entries(expected)) assertEqual(actual[key], value, `${label}.${key}`);
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`${label} must be a string array`);
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
}

function assertSHA256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be lowercase SHA-256 hex`);
}

function assertSize(value, label, allowZero) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} is invalid`);
}

function assertSafePath(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._/@+-]+$/u.test(value) || value.startsWith("/") || value.includes("\\")) {
    throw new Error(`${label} is unsafe`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new Error(`${label} is unsafe`);
}

function assertRFC3339(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an RFC 3339 UTC date-time`);
  }
}

function fileSHA256(path) {
  return sha256(readFileSync(path));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
NODE
