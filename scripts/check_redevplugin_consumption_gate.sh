#!/usr/bin/env bash
set -euo pipefail

MARKER_BASENAME=".redevplugin-release-artifacts-verified.json"
NOTICE_BASENAME="REDEVPLUGIN_THIRD_PARTY_NOTICES.md"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_redevplugin_consumption_gate.sh --scan-root <dir> [--scan-root <dir> ...] [--runtime-target <goos/arch>]
  ./scripts/check_redevplugin_consumption_gate.sh --self-test

Verifies that every supplied Redeven release staging directory or Desktop
bundle consumes a target-bound ReDevPlugin runtime, notice, or release artifact
from the closed marker v4 inventory emitted by
check_redevplugin_release_artifacts.sh --write-marker.
USAGE
}

scan_roots=()
self_test=0
runtime_target=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scan-root)
      if [[ $# -lt 2 ]]; then
        echo "--scan-root requires a directory" >&2
        usage >&2
        exit 2
      fi
      scan_roots+=("$2")
      shift 2
      ;;
    --self-test)
      self_test=1
      shift
      ;;
    --runtime-target)
      if [[ $# -lt 2 ]]; then
        echo "--runtime-target requires a goos/arch value" >&2
        usage >&2
        exit 2
      fi
      runtime_target="$2"
      shift 2
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

create_self_test_fixture() {
  local root="$1"
  FIXTURE_ROOT="$root" MARKER_BASENAME="$MARKER_BASENAME" node <<'NODE'
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = process.env.FIXTURE_ROOT;
const sourceRoot = `${root}-sources`;
const markerBasename = process.env.MARKER_BASENAME;
const releaseTag = "v0.0.0-test";
const releaseVersion = "0.0.0-test";
const sourceCommit = "1111111111111111111111111111111111111111";
const compatibilitySHA256 = "2222222222222222222222222222222222222222222222222222222222222222";
const contractRegistrySHA256 = "3333333333333333333333333333333333333333333333333333333333333333";
const npmPackage = {
  name: "@floegence/redevplugin-ui",
  version: releaseVersion,
  path: `npm/floegence-redevplugin-ui-${releaseVersion}.tgz`,
  sha256: "4444444444444444444444444444444444444444444444444444444444444444",
  integrity: "sha512-WyRUQ489hkBLGYixXFSSyErIn8MpKpU6spHCYaD3HH6/DH7XYChKXCTznT6y2rV1kB8hDMM3WpYj3GVooa9OPQ==",
  size: 101,
};
const workerSDK = {
  name: "redevplugin-worker-sdk",
  version: releaseVersion,
  path: `sdk/redevplugin-worker-sdk-${releaseVersion}.crate`,
  sha256: "5555555555555555555555555555555555555555555555555555555555555555",
  size: 102,
};
const targetSpecs = [
  ["aarch64-apple-darwin", "darwin/arm64"],
  ["aarch64-unknown-linux-gnu", "linux/arm64"],
  ["x86_64-apple-darwin", "darwin/amd64"],
  ["x86_64-unknown-linux-gnu", "linux/amd64"],
];

mkdirSync(root, { recursive: true });
mkdirSync(sourceRoot, { recursive: true });
mkdirSync(join(root, "npm"), { recursive: true });
mkdirSync(join(root, "sdk"), { recursive: true });
writeFileSync(join(root, "SHA256SUMS"), "self-test sums\n");
writeFileSync(join(root, "compatibility.json"), "self-test compatibility\n");
writeFileSync(join(root, "contract-registry-v1.json"), "self-test contracts\n");
writeFileSync(join(root, npmPackage.path), "self-test npm\n", { flag: "w" });
writeFileSync(join(root, workerSDK.path), "self-test worker sdk\n", { flag: "w" });

const evidenceSpecs = {
  stress: ["redevplugin-release-stress.json", "self-test stress\n"],
  a2_report: ["redevplugin-a2-acceptance.json", "self-test a2 report\n"],
  a2_supported: ["redevplugin-a2-supported.png", "self-test supported image\n"],
  a2_unsupported: ["redevplugin-a2-unsupported.png", "self-test unsupported image\n"],
};
const evidence = {};
for (const [key, [path, content]] of Object.entries(evidenceSpecs)) {
  const absolute = join(root, path);
  writeFileSync(absolute, content);
  evidence[key] = descriptor(path, absolute);
}

const performancePath = join(root, "performance-evidence.json");
writeFileSync(performancePath, "self-test performance\n");
const performanceEvidence = descriptor("performance-evidence.json", performancePath);
const targets = [];

for (const [targetIndex, [buildTriple, runtimeTarget]] of targetSpecs.entries()) {
  const bundleName = `redevplugin-${releaseTag}-${buildTriple}`;
  const bundleRoot = join(sourceRoot, bundleName);
  const runtimePath = join(bundleRoot, "bin", "redevplugin-runtime");
  const noticePath = join(bundleRoot, "THIRD_PARTY_NOTICES.md");
  const internalPerformancePath = join(bundleRoot, "performance-evidence.json");
  const internalContractRegistryPath = join(bundleRoot, "contracts", "spec", "plugin", "contract-registry-v1.json");
  mkdirSync(join(bundleRoot, "bin"), { recursive: true });
  mkdirSync(join(bundleRoot, "contracts", "spec", "plugin"), { recursive: true });
  const runtimeBytes = Buffer.alloc((2 << 20) + targetIndex + 1, 65 + targetIndex);
  runtimeBytes.set(Buffer.from(`self-test runtime ${runtimeTarget}\n`));
  writeFileSync(runtimePath, runtimeBytes);
  writeFileSync(noticePath, `self-test notices ${runtimeTarget}\n`);
  writeFileSync(internalPerformancePath, readFileSync(performancePath));
  writeFileSync(internalContractRegistryPath, "self-test contracts\n");

  const runtime = descriptor("bin/redevplugin-runtime", runtimePath);
  const thirdPartyNotices = descriptor("THIRD_PARTY_NOTICES.md", noticePath);
  const releaseManifest = {
    schema_version: "redevplugin.release_manifest.v4",
    version: releaseVersion,
    source_commit: sourceCommit,
    runtime_target: runtimeTarget,
    generated_at: "2026-07-19T00:00:00Z",
    compatibility_sha256: compatibilitySHA256,
    npm_package: npmPackage,
    worker_sdk: workerSDK,
    files: [
      runtime,
      thirdPartyNotices,
      {
        path: "contracts/spec/plugin/contract-registry-v1.json",
        sha256: contractRegistrySHA256,
        size: statSync(internalContractRegistryPath).size,
      },
      {
        path: "performance-evidence.json",
        sha256: performanceEvidence.sha256,
        size: performanceEvidence.size,
      },
    ],
  };
  const releaseManifestPath = join(bundleRoot, "release-manifest.json");
  writeFileSync(releaseManifestPath, `${JSON.stringify(releaseManifest)}\n`);
  const tarballName = `${bundleName}.tar.gz`;
  const tarballPath = join(root, tarballName);
  execFileSync("tar", ["--format=ustar", "-czf", tarballPath, "-C", sourceRoot, bundleName], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: "pipe",
  });
  const tarballDescriptor = descriptor(tarballName, tarballPath);
  targets.push({
    build_triple: buildTriple,
    runtime_target: runtimeTarget,
    tarball: { name: tarballName, sha256: tarballDescriptor.sha256, size: tarballDescriptor.size },
    release_manifest_sha256: fileHash(releaseManifestPath),
    runtime,
    third_party_notices: thirdPartyNotices,
  });
}

const marker = {
  schema_version: "redeven.redevplugin_artifact_verification.v4",
  release_tag: releaseTag,
  release_version: releaseVersion,
  source_commit: sourceCommit,
  sha256sums_sha256: fileHash(join(root, "SHA256SUMS")),
  compatibility_sha256: compatibilitySHA256,
  contract_registry_sha256: contractRegistrySHA256,
  npm_package: npmPackage,
  worker_sdk: workerSDK,
  performance_evidence: performanceEvidence,
  evidence,
  signing: {
    certificate_identity: `https://github.com/floegence/redevplugin/.github/workflows/release.yml@refs/tags/${releaseTag}`,
    oidc_issuer: "https://token.actions.githubusercontent.com",
  },
  targets,
};
writeFileSync(join(root, markerBasename), `${JSON.stringify(marker, null, 2)}\n`);

function descriptor(path, absolute) {
  return { path, sha256: fileHash(absolute), size: statSync(absolute).size };
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
NODE
}

read_fixture_profile() {
  local marker_path="$1"
  MARKER_PATH="$marker_path" node <<'NODE'
const { readFileSync } = require("node:fs");
const marker = JSON.parse(readFileSync(process.env.MARKER_PATH, "utf8"));
const descriptor = (value, extra = []) => Object.fromEntries(
  ["sha256", "size", ...extra].map((field) => [field, value[field]]),
);
process.stdout.write(JSON.stringify({
  releaseTag: marker.release_tag,
  releaseVersion: marker.release_version,
  sourceCommit: marker.source_commit,
  sha256sumsSHA256: marker.sha256sums_sha256,
  compatibilitySHA256: marker.compatibility_sha256,
  contractRegistrySHA256: marker.contract_registry_sha256,
  npmPackage: descriptor(marker.npm_package, ["integrity"]),
  workerSDK: descriptor(marker.worker_sdk),
  performanceEvidence: descriptor(marker.performance_evidence),
  evidence: Object.fromEntries(
    Object.entries(marker.evidence).map(([name, value]) => [name, descriptor(value)]),
  ),
  targets: Object.fromEntries(marker.targets.map((target) => [target.build_triple, {
    tarball: descriptor(target.tarball),
    releaseManifestSHA256: target.release_manifest_sha256,
    runtime: descriptor(target.runtime),
    notices: descriptor(target.third_party_notices),
  }])),
}));
NODE
}

assert_scan_root() {
  local root="$1"
  local internal_profile="$2"
  local expected_runtime_target="${3:-}"
  local fixture_profile_json="${4:-}"
  local marker_path="$root/$MARKER_BASENAME"

  SCAN_ROOT="$root" \
    MARKER_PATH="$marker_path" \
    MARKER_BASENAME="$MARKER_BASENAME" \
    NOTICE_BASENAME="$NOTICE_BASENAME" \
    INTERNAL_PROFILE="$internal_profile" \
    EXPECTED_RUNTIME_TARGET="$expected_runtime_target" \
    INTERNAL_FIXTURE_PROFILE="$fixture_profile_json" \
    node <<'NODE'
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { existsSync, lstatSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { basename, dirname, join, relative } = require("node:path");

const scanRoot = process.env.SCAN_ROOT;
const markerPath = process.env.MARKER_PATH;
const markerBasename = process.env.MARKER_BASENAME;
const noticeBasename = process.env.NOTICE_BASENAME;
const internalProfile = process.env.INTERNAL_PROFILE;
const expectedDirectRuntimeTarget = process.env.EXPECTED_RUNTIME_TARGET;
const targetMatrix = new Map([
  ["aarch64-apple-darwin", "darwin/arm64"],
  ["aarch64-unknown-linux-gnu", "linux/arm64"],
  ["x86_64-apple-darwin", "darwin/amd64"],
  ["x86_64-unknown-linux-gnu", "linux/amd64"],
]);
const maxReleaseManifestBytes = 4 << 20;
const maxMarkerArtifactBytes = 256 << 20;
const maxTarListingBytes = 8 << 20;
const productionProfile = Object.freeze({
  releaseTag: "v0.5.1",
  releaseVersion: "0.5.1",
  sourceCommit: "3febcc59bbdb2118a4f105781b4c743bc11ba09f",
  sha256sumsSHA256: "4776bd269a023a3ce4224b2f3598c1feae243b13e98a410e1614cabc87b11936",
  compatibilitySHA256: "e7ef9c519412c97239f8cc41a661334667773793670c742f26c7aed69257a04b",
  contractRegistrySHA256: "86cc5ccce02ef00b6cf8b44af07ad3a82867ee039d8d82ffc704194ee2c62547",
  npmPackage: Object.freeze({
    sha256: "d906629dccc84bce4e42bf2ce4ca62dc8412d5418686d1a7867bbca36dcf1efa",
    integrity: "sha512-WyRUQ489hkBLGYixXFSSyErIn8MpKpU6spHCYaD3HH6/DH7XYChKXCTznT6y2rV1kB8hDMM3WpYj3GVooa9OPQ==",
    size: 90317,
  }),
  workerSDK: Object.freeze({
    sha256: "2472cf284610a77fb9a6d0222ec676e4f363d06d445d573bd638e4241c5224ea",
    size: 9607,
  }),
  performanceEvidence: Object.freeze({ sha256: "810ab256be5b0b88a05f594370e46d10390789708ef3d2b56428d83d85e6b0e7", size: 16739 }),
  evidence: Object.freeze({
    stress: Object.freeze({ sha256: "f334cb5f2c5bdc16c7f492f6e4475d9ce573ee29086c8589b6674067c18db742", size: 2682 }),
    a2_report: Object.freeze({ sha256: "d01675e65459f213b4c74ba526352fbbb6250ebdf680ac8b197cc34a659b5250", size: 5368 }),
    a2_supported: Object.freeze({ sha256: "5e5431759cc4445d73934241fe521cbbf4e74897920fd40d394c715696444771", size: 111621 }),
    a2_unsupported: Object.freeze({ sha256: "893e2b2734c86049c5f7f80a63f7032947ed1049da4180fdad1679b4a0690d27", size: 113811 }),
  }),
  targets: Object.freeze({
    "aarch64-apple-darwin": Object.freeze({
      tarball: Object.freeze({ sha256: "7be98100880eabf42a26df7ac3d1350fdeafe6c5fb1f8290cd0695fdb91f0df5", size: 17158176 }),
      releaseManifestSHA256: "25b1a842cdd4b88524ae0f47b2c289cadd07d62e0ffab1264a7f4724466ad047",
      runtime: Object.freeze({ sha256: "fea17883ff27e943eeebc8bf9a68bd3d8c535b95d278fb18da0c3ec3d165dcca", size: 5055296 }),
      notices: Object.freeze({ sha256: "46753d2c64302bb211fe01865301d140d7d6cb996c5604ba4318fa0b905db530", size: 7936 }),
    }),
    "aarch64-unknown-linux-gnu": Object.freeze({
      tarball: Object.freeze({ sha256: "f752ef863ae62ec8208a2239d4704b501c099b0ab5f62cf469545079e17e89e0", size: 16671420 }),
      releaseManifestSHA256: "716451d062bcddff3f9897dd1dfec543c670ebb30bf2a72dd8ed086ce4b66e8c",
      runtime: Object.freeze({ sha256: "95cd87a998d8ae5c6ea3451551e72c69b8f5e27040b1016fcd39333e2b251b45", size: 5859144 }),
      notices: Object.freeze({ sha256: "46753d2c64302bb211fe01865301d140d7d6cb996c5604ba4318fa0b905db530", size: 7936 }),
    }),
    "x86_64-apple-darwin": Object.freeze({
      tarball: Object.freeze({ sha256: "54fb9a35b36f4a6a3c1212f834c843b263bf7e710c2d74d025e6ef53780ef670", size: 17963118 }),
      releaseManifestSHA256: "6e0d6a60750bc44854d25c0cbf0e10c7e600349225b9c41c2cbd34d1a74e385d",
      runtime: Object.freeze({ sha256: "eca4f841c60a3e2cb4e76c51567ed7d1cab60a16396db6cbdbaf3d1cc9559841", size: 5260056 }),
      notices: Object.freeze({ sha256: "46753d2c64302bb211fe01865301d140d7d6cb996c5604ba4318fa0b905db530", size: 7936 }),
    }),
    "x86_64-unknown-linux-gnu": Object.freeze({
      tarball: Object.freeze({ sha256: "020cc608fe221402f6f72c2e7408f40d26519a0ad391dfe04867d70bb12697b7", size: 17762212 }),
      releaseManifestSHA256: "0f522390e8a409d50d52bb74a7d39647e0be533e9436940df20d60fe0931d269",
      runtime: Object.freeze({ sha256: "4f9ccbe61463fa7dc0053086dca128743b493b74f5b4535994d6dbccde55aef4", size: 5910232 }),
      notices: Object.freeze({ sha256: "46753d2c64302bb211fe01865301d140d7d6cb996c5604ba4318fa0b905db530", size: 7936 }),
    }),
  }),
});
let fixtureProfile = null;
if (internalProfile === "fixture") {
  try {
    fixtureProfile = JSON.parse(process.env.INTERNAL_FIXTURE_PROFILE);
  } catch (error) {
    fail(`internal fixture profile is invalid: ${error.message}`);
  }
}

if (internalProfile !== "production" && internalProfile !== "fixture") {
  fail("internal release profile is invalid");
}
if (expectedDirectRuntimeTarget !== "" && ![...targetMatrix.values()].includes(expectedDirectRuntimeTarget)) {
  fail(`expected direct runtime target is unsupported: ${expectedDirectRuntimeTarget}`);
}

requireRegularFile(markerPath, `ReDevPlugin verifier marker ${markerPath}`);
const marker = readMarker(markerPath);
assertReleaseProfile(marker, internalProfile === "production" ? productionProfile : fixtureProfile);
const targetsByTarball = new Map(marker.targets.map((target) => [target.tarball.name, target]));
const targetsByRuntimeIdentity = new Map(marker.targets.map((target) => [artifactIdentity(target.runtime), target]));
const evidenceByBasename = new Map(Object.entries(marker.evidence).map(([key, value]) => [basename(value.path), { key, value }]));
const payloads = findPayloads(scanRoot);
if (payloads.length === 0) {
  fail(`scan root contains no ReDevPlugin payloads: ${scanRoot}`);
}
const directRuntimeCount = payloads.filter((payload) => payload.kind === "runtime").length;
if (directRuntimeCount > 0 && expectedDirectRuntimeTarget === "") {
  fail("a direct ReDevPlugin runtime requires an explicit expected runtime target");
}
if (directRuntimeCount === 0 && expectedDirectRuntimeTarget !== "") {
  fail("expected runtime target was provided for a scan root without a direct runtime");
}

for (const payload of payloads) {
  switch (payload.kind) {
    case "runtime":
      assertDirectRuntime(payload.path);
      break;
    case "evidence":
      assertFileDescriptor(payload.path, payload.descriptor, `${payload.description} ${payload.evidenceKey}`);
      break;
    case "redevplugin_tarball":
      assertReDevPluginTarball(payload.path);
      break;
    case "embedded_tarball":
      assertEmbeddedTarball(payload.path);
      break;
    default:
      fail(`unknown payload kind ${payload.kind}`);
  }
}

console.log(`[INFO] target-bound ReDevPlugin marker v4 verified for ${scanRoot}`);

function findPayloads(root) {
  const payloads = [];
  walk(root);
  return payloads;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const rel = relative(scanRoot, path).replaceAll("\\", "/");
      const linkStat = lstatSync(path);
      if (linkStat.isSymbolicLink()) {
        if (/^redevplugin-runtime(?:\.exe)?$/u.test(entry) || entry === noticeBasename || /^redevplugin-.+\.tar\.gz$/u.test(entry)) {
          fail(`ReDevPlugin payload must not be a symlink: ${path}`);
        }
        continue;
      }
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stat.isFile() || entry === markerBasename) {
        continue;
      }
      const description = join(scanRoot, rel);
      if (/^redevplugin-runtime(?:\.exe)?$/u.test(entry)) {
        payloads.push({ kind: "runtime", path, description });
        continue;
      }
      const evidence = evidenceByBasename.get(entry);
      if (evidence) {
        payloads.push({ kind: "evidence", path, description, evidenceKey: evidence.key, descriptor: evidence.value });
        continue;
      }
      if (/^redevplugin-.+\.tar\.gz$/u.test(entry)) {
        payloads.push({ kind: "redevplugin_tarball", path, description });
        continue;
      }
      if (entry.endsWith(".tar.gz") && tarballRuntimeEntries(path).length > 0) {
        payloads.push({ kind: "embedded_tarball", path, description: `${description}: contains redevplugin-runtime` });
      }
    }
  }
}

function readMarker(path) {
  let marker;
  try {
    marker = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`failed to parse marker JSON: ${error.message}`);
  }
  assertExactKeys(marker, [
    "schema_version", "release_tag", "release_version", "source_commit", "sha256sums_sha256",
    "compatibility_sha256", "contract_registry_sha256", "npm_package", "worker_sdk",
    "performance_evidence", "evidence", "signing", "targets",
  ], "marker");
  if (marker.schema_version !== "redeven.redevplugin_artifact_verification.v4") {
    fail("marker schema_version mismatch");
  }
  if (typeof marker.release_tag !== "string" || !/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u.test(marker.release_tag)) {
    fail("marker release_tag must be a canonical v-prefixed semantic version");
  }
  if (`v${marker.release_version}` !== marker.release_tag) {
    fail("marker release_version must match release_tag");
  }
  if (typeof marker.source_commit !== "string" || !/^[0-9a-f]{40}$/u.test(marker.source_commit)) {
    fail("marker source_commit must be a lowercase 40-character Git commit");
  }
  for (const field of ["sha256sums_sha256", "compatibility_sha256", "contract_registry_sha256"]) {
    assertSha256(marker[field], `marker ${field}`);
  }
  assertNpmPackage(marker.npm_package, marker.release_version);
  assertWorkerSDK(marker.worker_sdk, marker.release_version);
  assertArtifactDescriptor(marker.performance_evidence, "marker performance_evidence");
  if (marker.performance_evidence.path !== "performance-evidence.json") {
    fail("marker performance_evidence.path must be performance-evidence.json");
  }
  assertExactKeys(marker.evidence, ["stress", "a2_report", "a2_supported", "a2_unsupported"], "marker evidence");
  const evidencePaths = {
    stress: "redevplugin-release-stress.json",
    a2_report: "redevplugin-a2-acceptance.json",
    a2_supported: "redevplugin-a2-supported.png",
    a2_unsupported: "redevplugin-a2-unsupported.png",
  };
  for (const [key, expectedPath] of Object.entries(evidencePaths)) {
    assertArtifactDescriptor(marker.evidence[key], `marker evidence.${key}`);
    if (marker.evidence[key].path !== expectedPath) {
      fail(`marker evidence.${key}.path must be ${expectedPath}`);
    }
  }
  assertExactKeys(marker.signing, ["certificate_identity", "oidc_issuer"], "marker signing");
  const expectedIdentity = `https://github.com/floegence/redevplugin/.github/workflows/release.yml@refs/tags/${marker.release_tag}`;
  if (marker.signing.certificate_identity !== expectedIdentity) {
    fail("marker signing.certificate_identity does not bind the exact release tag");
  }
  if (marker.signing.oidc_issuer !== "https://token.actions.githubusercontent.com") {
    fail("marker signing.oidc_issuer mismatch");
  }
  if (!Array.isArray(marker.targets) || marker.targets.length !== targetMatrix.size) {
    fail(`marker targets must contain exactly ${targetMatrix.size} entries`);
  }
  const buildTriples = [];
  const runtimeTargets = new Set();
  const tarballNames = new Set();
  const runtimeIdentities = new Set();
  for (const [index, target] of marker.targets.entries()) {
    const label = `marker targets[${index}]`;
    assertExactKeys(target, ["build_triple", "runtime_target", "tarball", "release_manifest_sha256", "runtime", "third_party_notices"], label);
    const expectedRuntimeTarget = targetMatrix.get(target.build_triple);
    if (!expectedRuntimeTarget || target.runtime_target !== expectedRuntimeTarget) {
      fail(`${label} build_triple/runtime_target mapping is invalid`);
    }
    buildTriples.push(target.build_triple);
    if (runtimeTargets.has(target.runtime_target)) {
      fail(`${label}.runtime_target is duplicated`);
    }
    runtimeTargets.add(target.runtime_target);
    assertArtifactDescriptor(target.tarball, `${label}.tarball`);
    const expectedTarballName = `redevplugin-${marker.release_tag}-${target.build_triple}.tar.gz`;
    if (target.tarball.name !== expectedTarballName || "path" in target.tarball) {
      fail(`${label}.tarball.name must be ${expectedTarballName}`);
    }
    if (tarballNames.has(target.tarball.name)) {
      fail(`${label}.tarball.name is duplicated`);
    }
    tarballNames.add(target.tarball.name);
    assertSha256(target.release_manifest_sha256, `${label}.release_manifest_sha256`);
    assertArtifactDescriptor(target.runtime, `${label}.runtime`);
    if (target.runtime.path !== "bin/redevplugin-runtime") {
      fail(`${label}.runtime.path must be bin/redevplugin-runtime`);
    }
    const identity = artifactIdentity(target.runtime);
    if (runtimeIdentities.has(identity)) {
      fail(`${label}.runtime is not uniquely target-bound`);
    }
    runtimeIdentities.add(identity);
    assertArtifactDescriptor(target.third_party_notices, `${label}.third_party_notices`);
    if (target.third_party_notices.path !== "THIRD_PARTY_NOTICES.md") {
      fail(`${label}.third_party_notices.path must be THIRD_PARTY_NOTICES.md`);
    }
  }
  const canonicalBuildTriples = [...targetMatrix.keys()];
  if (JSON.stringify(buildTriples) !== JSON.stringify(canonicalBuildTriples)) {
    fail("marker targets must use canonical build_triple order");
  }
  return marker;
}

function assertReleaseProfile(value, expected) {
  const exactFields = [
    ["release_tag", expected.releaseTag],
    ["release_version", expected.releaseVersion],
    ["source_commit", expected.sourceCommit],
    ["sha256sums_sha256", expected.sha256sumsSHA256],
    ["compatibility_sha256", expected.compatibilitySHA256],
    ["contract_registry_sha256", expected.contractRegistrySHA256],
  ];
  for (const [field, wanted] of exactFields) {
    if (value[field] !== wanted) fail(`marker ${field} is not approved by the ${internalProfile} release profile`);
  }
  assertPinnedDescriptor(value.npm_package, expected.npmPackage, "marker npm_package");
  assertPinnedDescriptor(value.worker_sdk, expected.workerSDK, "marker worker_sdk");
  assertPinnedDescriptor(value.performance_evidence, expected.performanceEvidence, "marker performance_evidence");
  for (const [name, descriptor] of Object.entries(expected.evidence)) {
    assertPinnedDescriptor(value.evidence[name], descriptor, `marker evidence.${name}`);
  }
  for (const target of value.targets) {
    const pinned = expected.targets[target.build_triple];
    if (!pinned) fail(`marker target ${target.build_triple} is not approved by the ${internalProfile} profile`);
    assertPinnedDescriptor(target.tarball, pinned.tarball, `marker target ${target.build_triple} tarball`);
    if (target.release_manifest_sha256 !== pinned.releaseManifestSHA256) {
      fail(`marker target ${target.build_triple} release manifest is not approved by the production profile`);
    }
    assertPinnedDescriptor(target.runtime, pinned.runtime, `marker target ${target.build_triple} runtime`);
    assertPinnedDescriptor(target.third_party_notices, pinned.notices, `marker target ${target.build_triple} notices`);
  }
}

function assertPinnedDescriptor(actual, expected, label) {
  for (const [field, wanted] of Object.entries(expected)) {
    if (actual[field] !== wanted) fail(`${label}.${field} is not approved by the ${internalProfile} release profile`);
  }
}

function assertNpmPackage(value, releaseVersion) {
  assertExactKeys(value, ["name", "version", "path", "sha256", "integrity", "size"], "marker npm_package");
  if (value.name !== "@floegence/redevplugin-ui" || value.version !== releaseVersion) {
    fail("marker npm_package identity must match the release");
  }
  if (value.path !== `npm/floegence-redevplugin-ui-${releaseVersion}.tgz`) {
    fail("marker npm_package.path mismatch");
  }
  assertSha256(value.sha256, "marker npm_package.sha256");
  if (typeof value.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(value.integrity)) {
    fail("marker npm_package.integrity must be canonical sha512 SRI");
  }
  assertPositiveSize(value.size, "marker npm_package.size");
}

function assertWorkerSDK(value, releaseVersion) {
  assertExactKeys(value, ["name", "version", "path", "sha256", "size"], "marker worker_sdk");
  if (value.name !== "redevplugin-worker-sdk" || value.version !== releaseVersion) {
    fail("marker worker_sdk identity must match the release");
  }
  if (value.path !== `sdk/redevplugin-worker-sdk-${releaseVersion}.crate`) {
    fail("marker worker_sdk.path mismatch");
  }
  assertSha256(value.sha256, "marker worker_sdk.sha256");
  assertPositiveSize(value.size, "marker worker_sdk.size");
}

function assertArtifactDescriptor(value, label) {
  if (value && Object.hasOwn(value, "name")) {
    assertExactKeys(value, ["name", "sha256", "size"], label);
    if (typeof value.name !== "string" || value.name.trim() === "" || basename(value.name) !== value.name) {
      fail(`${label}.name must be a safe basename`);
    }
  } else {
    assertExactKeys(value, ["path", "sha256", "size"], label);
    assertSafeRelativePath(value.path, `${label}.path`);
  }
  assertSha256(value.sha256, `${label}.sha256`);
  assertPositiveSize(value.size, `${label}.size`);
}

function assertDirectRuntime(path) {
  const descriptor = fileDescriptor(path);
  const target = targetsByRuntimeIdentity.get(artifactIdentity(descriptor));
  if (!target) {
    fail(`${path} runtime binary is not bound to exactly one marker target`);
  }
  if (target.runtime_target !== expectedDirectRuntimeTarget) {
    fail(`${path} runtime target ${target.runtime_target} does not match expected target ${expectedDirectRuntimeTarget}`);
  }
  const noticePath = join(dirname(path), noticeBasename);
  requireRegularFile(noticePath, `${path} target-bound ReDevPlugin notices`);
  assertFileDescriptor(noticePath, target.third_party_notices, `${noticePath} notices for ${target.runtime_target}`);
}

function assertReDevPluginTarball(path) {
  const target = targetsByTarball.get(basename(path));
  if (!target) {
    fail(`${path} is not a target-bound ReDevPlugin tarball in the verifier marker`);
  }
  assertFileDescriptor(path, target.tarball, `${path} tarball for ${target.runtime_target}`);
  const entries = tarballEntries(path);
  const bundleRoot = target.tarball.name.slice(0, -".tar.gz".length);
  const releaseManifestEntry = resolveReleaseBundleEntry(entries, bundleRoot, "release-manifest.json", path);
  const prefix = releaseManifestEntry.slice(0, -"release-manifest.json".length);
  const runtimeEntry = requireTarballEntry(entries, `${prefix}${target.runtime.path}`, path);
  const noticeEntry = requireTarballEntry(entries, `${prefix}${target.third_party_notices.path}`, path);
  const releaseManifestBytes = readTarballEntry(path, releaseManifestEntry, maxReleaseManifestBytes);
  assertHashMatch(bufferHash(releaseManifestBytes), target.release_manifest_sha256, `${path}:${releaseManifestEntry}`);
  assertBufferDescriptor(readTarballEntry(path, runtimeEntry, target.runtime.size), target.runtime, `${path}:${runtimeEntry}`);
  assertBufferDescriptor(readTarballEntry(path, noticeEntry, target.third_party_notices.size), target.third_party_notices, `${path}:${noticeEntry}`);
  verifyReleaseManifest(releaseManifestBytes, target, path);
}

function verifyReleaseManifest(bytes, target, tarballPath) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${tarballPath}: release-manifest.json is invalid: ${error.message}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`${tarballPath}: release-manifest.json must be an object`);
  }
  if (manifest.schema_version !== "redevplugin.release_manifest.v4" || manifest.version !== marker.release_version || manifest.source_commit !== marker.source_commit) {
    fail(`${tarballPath}: release manifest identity does not match marker`);
  }
  if (manifest.runtime_target !== target.runtime_target || manifest.compatibility_sha256 !== marker.compatibility_sha256) {
    fail(`${tarballPath}: release manifest target or compatibility hash does not match marker`);
  }
  if (canonicalJSON(manifest.npm_package) !== canonicalJSON(marker.npm_package) || canonicalJSON(manifest.worker_sdk) !== canonicalJSON(marker.worker_sdk)) {
    fail(`${tarballPath}: release manifest SDK inventory does not match marker`);
  }
  if (!Array.isArray(manifest.files)) {
    fail(`${tarballPath}: release manifest files must be an array`);
  }
  assertManifestFile(manifest.files, target.runtime, `${tarballPath}: runtime manifest entry`);
  assertManifestFile(manifest.files, target.third_party_notices, `${tarballPath}: notices manifest entry`);
  assertManifestFile(manifest.files, {
    path: "contracts/spec/plugin/contract-registry-v1.json",
    sha256: marker.contract_registry_sha256,
  }, `${tarballPath}: contract registry manifest entry`, false);
  assertManifestFile(manifest.files, marker.performance_evidence, `${tarballPath}: performance evidence manifest entry`);
}

function assertManifestFile(files, expected, label, checkSize = true) {
  const matches = files.filter((file) => file && file.path === expected.path);
  if (matches.length !== 1 || matches[0].sha256 !== expected.sha256 || (checkSize && matches[0].size !== expected.size)) {
    fail(`${label} does not match marker`);
  }
}

function assertEmbeddedTarball(path) {
  const runtimeEntries = tarballRuntimeEntries(path);
  if (runtimeEntries.length !== 1) {
    fail(`${path} must contain exactly one ReDevPlugin runtime`);
  }
  const runtimeReadLimit = Math.max(...marker.targets.map((candidate) => candidate.runtime.size));
  const runtimeBytes = readTarballEntry(path, runtimeEntries[0], runtimeReadLimit);
  const runtimeIdentity = `${bufferHash(runtimeBytes)}:${runtimeBytes.length}`;
  const target = targetsByRuntimeIdentity.get(runtimeIdentity);
  if (!target) {
    fail(`${path}:${runtimeEntries[0]} runtime is not bound to exactly one marker target`);
  }
  const expectedRuntimeTarget = consumerTarballRuntimeTarget(basename(path));
  if (target.runtime_target !== expectedRuntimeTarget) {
    fail(`${path}:${runtimeEntries[0]} runtime target ${target.runtime_target} does not match consumer tarball target ${expectedRuntimeTarget}`);
  }
  const noticeEntries = tarballNoticeEntries(path);
  if (noticeEntries.length !== 1) {
    fail(`${path} must contain exactly one ${noticeBasename} entry with its ReDevPlugin runtime`);
  }
  assertBufferDescriptor(readTarballEntry(path, noticeEntries[0], target.third_party_notices.size), target.third_party_notices, `${path}:${noticeEntries[0]} notices for ${target.runtime_target}`);
}

function consumerTarballRuntimeTarget(name) {
  const match = name.match(/^redeven_(darwin|linux)_(amd64|arm64)\.tar\.gz$/u);
  if (!match) {
    fail(`consumer tarball with ReDevPlugin runtime has no closed target identity: ${name}`);
  }
  return `${match[1]}/${match[2]}`;
}

function resolveReleaseBundleEntry(entries, bundleRoot, relativePath, tarballPath) {
  const flat = relativePath;
  const rooted = `${bundleRoot}/${relativePath}`;
  const matches = entries.filter((entry) => entry === flat || entry === rooted);
  if (matches.length !== 1) {
    fail(`${tarballPath} must contain exactly one ${relativePath} at the verified bundle root`);
  }
  return matches[0];
}

function requireTarballEntry(entries, expected, tarballPath) {
  const matches = entries.filter((entry) => entry === expected);
  if (matches.length !== 1) {
    fail(`${tarballPath} must contain exactly one target-bound entry ${expected}`);
  }
  return matches[0];
}

function tarballRuntimeEntries(path) {
  return tarballEntries(path).filter((entry) => /(^|\/)redevplugin-runtime$/u.test(entry));
}

function tarballNoticeEntries(path) {
  return tarballEntries(path).filter((entry) => entry.endsWith(`/${noticeBasename}`) || entry === noticeBasename);
}

function tarballEntries(path) {
  let output;
  try {
    output = execFileSync("tar", ["-tzf", path], {
      encoding: "utf8",
      maxBuffer: maxTarListingBytes,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(`cannot inspect tarball ${path}: ${error.message}`);
  }
  return output.split(/\r?\n/u).filter(Boolean).map((entry) => {
    const normalized = entry.replace(/^\.\//u, "");
    if (normalized.startsWith("/") || normalized.includes("\\") || normalized.split("/").some((part) => part === "..")) {
      fail(`tarball contains unsafe entry ${JSON.stringify(entry)}: ${path}`);
    }
    return normalized;
  });
}

function readTarballEntry(path, entry, declaredSizeLimit) {
  if (!Number.isSafeInteger(declaredSizeLimit) || declaredSizeLimit <= 0 || declaredSizeLimit > maxMarkerArtifactBytes) {
    fail(`${path}:${entry} has an invalid extraction size limit`);
  }
  try {
    const bytes = execFileSync("tar", ["-xOf", path, entry], {
      maxBuffer: declaredSizeLimit + (64 << 10),
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (bytes.length > declaredSizeLimit) {
      fail(`${path}:${entry} exceeds its declared extraction size limit`);
    }
    return bytes;
  } catch (error) {
    fail(`${path}:${entry} could not be read: ${error.message}`);
  }
}

function assertFileDescriptor(path, expected, label) {
  requireRegularFile(path, label);
  const stat = statSync(path);
  assertHashMatch(fileHash(path), expected.sha256, label);
  if (stat.size !== expected.size) {
    fail(`${label} size mismatch: got ${stat.size}, want ${expected.size}`);
  }
}

function assertBufferDescriptor(bytes, expected, label) {
  assertHashMatch(bufferHash(bytes), expected.sha256, label);
  if (bytes.length !== expected.size) {
    fail(`${label} size mismatch: got ${bytes.length}, want ${expected.size}`);
  }
}

function fileDescriptor(path) {
  return { sha256: fileHash(path), size: statSync(path).size };
}

function artifactIdentity(value) {
  return `${value.sha256}:${value.size}`;
}

function requireRegularFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing`);
  }
  const linkStat = lstatSync(path);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    fail(`${label} must be a regular file`);
  }
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} fields mismatch`);
  }
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._/@+-]+$/u.test(value) || value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail(`${label} must be a normalized relative artifact path`);
  }
}

function assertPositiveSize(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maxMarkerArtifactBytes) {
    fail(`${label} must be a positive safe integer within the artifact byte limit`);
  }
}

function assertHashMatch(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} checksum mismatch: got ${actual}, want ${expected}`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be lowercase SHA-256 hex`);
  }
}

function fileHash(path) {
  return bufferHash(readFileSync(path));
}

function bufferHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJSON(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(message) {
  console.error(`[redevplugin-consumption] ${message}`);
  process.exit(1);
}
NODE
}

expect_fixture_scan_failure() {
  local root="$1"
  local message="$2"
  local expected_fragment="$3"
  local expected_runtime_target="${4:-}"
  local output
  if output=$(assert_scan_root "$root" fixture "$expected_runtime_target" "$fixture_profile" 2>&1); then
    echo "self-test expected $message to fail" >&2
    exit 1
  fi
  if [[ "$output" != *"$expected_fragment"* ]]; then
    echo "self-test $message failed for the wrong reason: $output" >&2
    exit 1
  fi
}

if [[ "$self_test" -eq 1 ]]; then
  if [[ "${#scan_roots[@]}" -gt 0 || -n "$runtime_target" ]]; then
    echo "--self-test cannot be combined with scan arguments" >&2
    exit 2
  fi
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  fixture_root="$tmpdir/fixture"
  create_self_test_fixture "$fixture_root"
  marker_path="$fixture_root/$MARKER_BASENAME"
  fixture_profile=$(read_fixture_profile "$marker_path")
  trusted_build="aarch64-apple-darwin"
  other_build="aarch64-unknown-linux-gnu"
  trusted_bundle="$fixture_root-sources/redevplugin-v0.0.0-test-$trusted_build"
  other_bundle="$fixture_root-sources/redevplugin-v0.0.0-test-$other_build"
  trusted_tarball="$fixture_root/redevplugin-v0.0.0-test-$trusted_build.tar.gz"
  trusted_stress="$fixture_root/redevplugin-release-stress.json"

  assert_scan_root "$fixture_root" fixture "" "$fixture_profile"
  if output=$("$0" --scan-root "$fixture_root" 2>&1); then
    echo "self-test fixture marker must not pass the production CLI profile" >&2
    exit 1
  fi
  if [[ "$output" != *"marker release_tag is not approved by the production release profile"* ]]; then
    echo "self-test fixture marker production rejection used the wrong failure: $output" >&2
    exit 1
  fi
  if output=$("$0" --profile fixture --scan-root "$fixture_root" 2>&1); then
    echo "self-test production CLI must not expose the fixture profile" >&2
    exit 1
  fi
  if [[ "$output" != *"unexpected argument: --profile"* ]]; then
    echo "self-test fixture profile option used the wrong failure: $output" >&2
    exit 1
  fi

  clean_root="$tmpdir/clean"
  mkdir -p "$clean_root"
  cp "$marker_path" "$clean_root/$MARKER_BASENAME"
  expect_fixture_scan_failure "$clean_root" "a marker-only no-op scan root" "scan root contains no ReDevPlugin payloads"

  missing_marker_root="$tmpdir/missing-marker"
  mkdir -p "$missing_marker_root/bin"
  cp "$trusted_bundle/bin/redevplugin-runtime" "$missing_marker_root/bin/redevplugin-runtime"
  expect_fixture_scan_failure "$missing_marker_root" "a missing marker" "verifier marker" "darwin/arm64"

  invalid_marker_root="$tmpdir/invalid-marker"
  mkdir -p "$invalid_marker_root/bin"
  cp "$trusted_bundle/bin/redevplugin-runtime" "$invalid_marker_root/bin/redevplugin-runtime"
  printf '{}\n' >"$invalid_marker_root/$MARKER_BASENAME"
  expect_fixture_scan_failure "$invalid_marker_root" "an invalid marker" "marker fields mismatch" "darwin/arm64"

  valid_runtime_root="$tmpdir/valid-runtime"
  mkdir -p "$valid_runtime_root/bin"
  cp "$trusted_bundle/bin/redevplugin-runtime" "$valid_runtime_root/bin/redevplugin-runtime"
  cp "$trusted_bundle/THIRD_PARTY_NOTICES.md" "$valid_runtime_root/bin/$NOTICE_BASENAME"
  cp "$marker_path" "$valid_runtime_root/$MARKER_BASENAME"
  assert_scan_root "$valid_runtime_root" fixture "darwin/arm64" "$fixture_profile"
  expect_fixture_scan_failure "$valid_runtime_root" "a direct runtime without target context" "requires an explicit expected runtime target"
  expect_fixture_scan_failure "$valid_runtime_root" "a direct runtime with the wrong target context" "does not match expected target linux/arm64" "linux/arm64"

  runtime_mismatch_root="$tmpdir/runtime-mismatch"
  cp -R "$valid_runtime_root" "$runtime_mismatch_root"
  printf 'tampered runtime\n' >"$runtime_mismatch_root/bin/redevplugin-runtime"
  expect_fixture_scan_failure "$runtime_mismatch_root" "a direct runtime hash mismatch" "runtime binary is not bound" "darwin/arm64"

  notice_missing_root="$tmpdir/notice-missing"
  cp -R "$valid_runtime_root" "$notice_missing_root"
  rm "$notice_missing_root/bin/$NOTICE_BASENAME"
  expect_fixture_scan_failure "$notice_missing_root" "missing target-bound notices" "target-bound ReDevPlugin notices" "darwin/arm64"

  cross_target_notice_root="$tmpdir/cross-target-notice"
  cp -R "$valid_runtime_root" "$cross_target_notice_root"
  cp "$other_bundle/THIRD_PARTY_NOTICES.md" "$cross_target_notice_root/bin/$NOTICE_BASENAME"
  expect_fixture_scan_failure "$cross_target_notice_root" "cross-target notices" "notices for darwin/arm64 checksum mismatch" "darwin/arm64"

  release_tarball_root="$tmpdir/release-tarball"
  mkdir -p "$release_tarball_root"
  cp "$trusted_tarball" "$release_tarball_root/"
  cp "$marker_path" "$release_tarball_root/$MARKER_BASENAME"
  assert_scan_root "$release_tarball_root" fixture "" "$fixture_profile"

  release_tarball_mismatch_root="$tmpdir/release-tarball-mismatch"
  cp -R "$release_tarball_root" "$release_tarball_mismatch_root"
  printf 'tampered\n' >>"$release_tarball_mismatch_root/$(basename -- "$trusted_tarball")"
  expect_fixture_scan_failure "$release_tarball_mismatch_root" "a release tarball hash mismatch" "tarball for darwin/arm64 checksum mismatch"

  stress_mismatch_root="$tmpdir/stress-mismatch"
  mkdir -p "$stress_mismatch_root"
  cp "$trusted_stress" "$stress_mismatch_root/"
  cp "$marker_path" "$stress_mismatch_root/$MARKER_BASENAME"
  printf 'tampered stress\n' >"$stress_mismatch_root/$(basename -- "$trusted_stress")"
  expect_fixture_scan_failure "$stress_mismatch_root" "a stress evidence mismatch" "stress checksum mismatch"

  embedded_root="$tmpdir/embedded"
  mkdir -p "$embedded_root/payload/bin"
  cp "$trusted_bundle/bin/redevplugin-runtime" "$embedded_root/payload/bin/redevplugin-runtime"
  cp "$trusted_bundle/THIRD_PARTY_NOTICES.md" "$embedded_root/payload/$NOTICE_BASENAME"
  COPYFILE_DISABLE=1 tar --format=ustar -czf "$embedded_root/redeven_darwin_arm64.tar.gz" -C "$embedded_root/payload" .
  rm -rf "$embedded_root/payload"
  expect_fixture_scan_failure "$embedded_root" "an embedded runtime without a marker" "verifier marker"
  cp "$marker_path" "$embedded_root/$MARKER_BASENAME"
  assert_scan_root "$embedded_root" fixture "" "$fixture_profile"

  cross_target_tarball_root="$tmpdir/cross-target-tarball"
  mkdir -p "$cross_target_tarball_root/payload/bin"
  cp "$trusted_bundle/bin/redevplugin-runtime" "$cross_target_tarball_root/payload/bin/redevplugin-runtime"
  cp "$trusted_bundle/THIRD_PARTY_NOTICES.md" "$cross_target_tarball_root/payload/$NOTICE_BASENAME"
  COPYFILE_DISABLE=1 tar --format=ustar -czf "$cross_target_tarball_root/redeven_linux_arm64.tar.gz" -C "$cross_target_tarball_root/payload" .
  rm -rf "$cross_target_tarball_root/payload"
  cp "$marker_path" "$cross_target_tarball_root/$MARKER_BASENAME"
  expect_fixture_scan_failure "$cross_target_tarball_root" "a cross-target consumer tarball" "does not match consumer tarball target linux/arm64"

  embedded_mismatch_root="$tmpdir/embedded-mismatch"
  mkdir -p "$embedded_mismatch_root/payload/bin"
  printf 'tampered runtime\n' >"$embedded_mismatch_root/payload/bin/redevplugin-runtime"
  cp "$trusted_bundle/THIRD_PARTY_NOTICES.md" "$embedded_mismatch_root/payload/$NOTICE_BASENAME"
  COPYFILE_DISABLE=1 tar --format=ustar -czf "$embedded_mismatch_root/redeven_linux_arm64.tar.gz" -C "$embedded_mismatch_root/payload" .
  rm -rf "$embedded_mismatch_root/payload"
  cp "$marker_path" "$embedded_mismatch_root/$MARKER_BASENAME"
  expect_fixture_scan_failure "$embedded_mismatch_root" "an embedded runtime mismatch" "runtime is not bound"

  legacy_marker_root="$tmpdir/legacy-marker"
  cp -R "$valid_runtime_root" "$legacy_marker_root"
  MARKER_PATH="$legacy_marker_root/$MARKER_BASENAME" node <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const marker = JSON.parse(readFileSync(process.env.MARKER_PATH, "utf8"));
marker.schema_version = "redeven.redevplugin_artifact_verification.v3";
writeFileSync(process.env.MARKER_PATH, `${JSON.stringify(marker)}\n`);
NODE
  expect_fixture_scan_failure "$legacy_marker_root" "a legacy marker" "marker schema_version mismatch" "darwin/arm64"

  unknown_field_root="$tmpdir/unknown-field"
  cp -R "$valid_runtime_root" "$unknown_field_root"
  MARKER_PATH="$unknown_field_root/$MARKER_BASENAME" node <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const marker = JSON.parse(readFileSync(process.env.MARKER_PATH, "utf8"));
marker.optional = true;
writeFileSync(process.env.MARKER_PATH, `${JSON.stringify(marker)}\n`);
NODE
  expect_fixture_scan_failure "$unknown_field_root" "an optional marker field" "marker fields mismatch" "darwin/arm64"

  size_mismatch_root="$tmpdir/size-mismatch"
  cp -R "$valid_runtime_root" "$size_mismatch_root"
  MARKER_PATH="$size_mismatch_root/$MARKER_BASENAME" node <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const marker = JSON.parse(readFileSync(process.env.MARKER_PATH, "utf8"));
marker.targets[0].runtime.size += 1;
writeFileSync(process.env.MARKER_PATH, `${JSON.stringify(marker)}\n`);
NODE
  expect_fixture_scan_failure "$size_mismatch_root" "a target runtime size mismatch" "runtime.size is not approved by the fixture release profile" "darwin/arm64"

  exit 0
fi

if [[ "${#scan_roots[@]}" -eq 0 ]]; then
  usage >&2
  exit 2
fi

if [[ "${#scan_roots[@]}" -ne 1 && -n "$runtime_target" ]]; then
  echo "[redevplugin-consumption] --runtime-target requires exactly one --scan-root" >&2
  exit 2
fi

for root in "${scan_roots[@]}"; do
  if [[ ! -d "$root" ]]; then
    echo "[redevplugin-consumption] scan root not found: $root" >&2
    exit 1
  fi
  assert_scan_root "$root" production "$runtime_target"
done
