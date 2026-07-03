#!/usr/bin/env bash
set -euo pipefail

MARKER_BASENAME=".redevplugin-release-artifacts-verified.json"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/stage_redevplugin_release_artifacts.sh --version <vX.Y.Z> --dest-dir <dir> [--repo <owner/repo>] [--skip-cosign]
  ./scripts/stage_redevplugin_release_artifacts.sh --source-dir <dir> --dest-dir <dir> [--version <vX.Y.Z>] [--skip-cosign]
  ./scripts/stage_redevplugin_release_artifacts.sh --version <vX.Y.Z> --dest-dir <dir> --runtime-target <target> --runtime-out <file> [--repo <owner/repo>] [--skip-cosign]
  ./scripts/stage_redevplugin_release_artifacts.sh --version <vX.Y.Z> --dest-dir <dir> --redeven-goos <goos> --redeven-goarch <goarch> --runtime-out <file> [--repo <owner/repo>] [--skip-cosign]
  ./scripts/stage_redevplugin_release_artifacts.sh --self-test

Downloads or copies a released ReDevPlugin artifact set, verifies the release
evidence, writes a verifier marker, and validates the staged payloads with the
Redeven consumption gate. When --runtime-target and --runtime-out are supplied,
the matching verified redevplugin-runtime binary is extracted and the marker is
copied next to it so downstream staging roots can be scanned directly.
USAGE
}

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)

VERSION=""
SOURCE_DIR=""
DEST_DIR=""
REPO="floegence/redevplugin"
RUNTIME_TARGET=""
REDEVEN_GOOS=""
REDEVEN_GOARCH=""
RUNTIME_OUT=""
MARKER_OUT=""
SKIP_COSIGN=0
SELF_TEST=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      if [[ $# -lt 2 ]]; then
        echo "--version requires a release tag" >&2
        usage >&2
        exit 2
      fi
      VERSION="$2"
      shift 2
      ;;
    --source-dir)
      if [[ $# -lt 2 ]]; then
        echo "--source-dir requires a directory" >&2
        usage >&2
        exit 2
      fi
      SOURCE_DIR="$2"
      shift 2
      ;;
    --dest-dir)
      if [[ $# -lt 2 ]]; then
        echo "--dest-dir requires a directory" >&2
        usage >&2
        exit 2
      fi
      DEST_DIR="$2"
      shift 2
      ;;
    --repo)
      if [[ $# -lt 2 ]]; then
        echo "--repo requires an owner/repo value" >&2
        usage >&2
        exit 2
      fi
      REPO="$2"
      shift 2
      ;;
    --runtime-target)
      if [[ $# -lt 2 ]]; then
        echo "--runtime-target requires a ReDevPlugin runtime target" >&2
        usage >&2
        exit 2
      fi
      RUNTIME_TARGET="$2"
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

assert_release_tag() {
  local tag="$1"
  if [[ ! "$tag" =~ ^v[0-9]+(\.[0-9]+){2}([-.][A-Za-z0-9._-]+)?$ ]]; then
    die "ReDevPlugin release tag must look like vX.Y.Z: $tag"
  fi
}

resolve_redevplugin_runtime_target() {
  local goos="$1"
  local goarch="$2"

  case "${goos}/${goarch}" in
    linux/amd64)
      printf 'x86_64-unknown-linux-gnu\n'
      ;;
    linux/arm64)
      printf 'aarch64-unknown-linux-gnu\n'
      ;;
    darwin/amd64)
      printf 'x86_64-apple-darwin\n'
      ;;
    darwin/arm64)
      printf 'aarch64-apple-darwin\n'
      ;;
    *)
      die "unsupported Redeven target for ReDevPlugin runtime artifact: ${goos}/${goarch}"
      ;;
  esac
}

assert_safe_clean_dir() {
  local path="$1"
  if [[ -z "$path" || "$path" == "/" || "$path" == "." || "$path" == "$ROOT_DIR" ]]; then
    die "refusing to clean unsafe destination: $path"
  fi
}

prepare_dest_dir() {
  local dest="$1"
  assert_safe_clean_dir "$dest"
  rm -rf "$dest"
  mkdir -p "$dest"
}

copy_source_artifacts() {
  local source="$1"
  local dest="$2"

  if [[ ! -d "$source" ]]; then
    die "source artifact directory not found: $source"
  fi
  find "$source" -maxdepth 1 -type f ! -name "$MARKER_BASENAME" -exec cp {} "$dest/" \;
}

download_release_artifacts() {
  local version="$1"
  local repo="$2"
  local dest="$3"

  require_command gh
  gh release download "$version" \
    --repo "$repo" \
    --dir "$dest" \
    --pattern "SHA256SUMS*" \
    --pattern "redevplugin-release-stress.json*" \
    --pattern "redevplugin-${version}-*.tar.gz*"
}

verify_staged_artifacts() {
  local dest="$1"
  local marker="$dest/$MARKER_BASENAME"
  local verifier_args=("--artifact-dir" "$dest" "--write-marker" "$marker")

  if [[ "$SKIP_COSIGN" -eq 1 ]]; then
    verifier_args+=("--skip-cosign")
  fi

  "$SCRIPT_DIR/check_redevplugin_release_artifacts.sh" "${verifier_args[@]}"
  "$SCRIPT_DIR/check_redevplugin_consumption_gate.sh" --scan-root "$dest"
}

resolve_runtime_tarball() {
  local dest="$1"
  local version="$2"
  local target="$3"
  local expected

  if [[ -n "$version" ]]; then
    expected="$dest/redevplugin-${version}-${target}.tar.gz"
    if [[ ! -f "$expected" ]]; then
      die "verified ReDevPlugin runtime tarball not found for target ${target}: $expected"
    fi
    printf '%s\n' "$expected"
    return 0
  fi

  local matches=()
  while IFS= read -r match; do
    matches+=("$match")
  done < <(find "$dest" -maxdepth 1 -type f -name "redevplugin-*-${target}.tar.gz" | sort)
  if [[ "${#matches[@]}" -ne 1 ]]; then
    die "expected exactly one ReDevPlugin tarball for target ${target}, found ${#matches[@]}"
  fi
  printf '%s\n' "${matches[0]}"
}

resolve_extracted_bundle_root() {
  local extract_root="$1"
  if [[ -f "$extract_root/release-manifest.json" ]]; then
    printf '%s\n' "$extract_root"
    return 0
  fi

  local roots=()
  while IFS= read -r root; do
    roots+=("$root")
  done < <(find "$extract_root" -mindepth 1 -maxdepth 1 -type d | sort)
  if [[ "${#roots[@]}" -ne 1 || ! -f "${roots[0]}/release-manifest.json" ]]; then
    die "ReDevPlugin runtime tarball must contain a flat bundle or one top-level bundle directory"
  fi
  printf '%s\n' "${roots[0]}"
}

extract_runtime_binary() {
  local dest="$1"
  local version="$2"
  local target="$3"
  local runtime_out="$4"
  local marker="$dest/$MARKER_BASENAME"
  local tarball tmpdir root runtime_source runtime_dir

  tarball="$(resolve_runtime_tarball "$dest" "$version" "$target")"
  tmpdir=$(mktemp -d)
  tar -xzf "$tarball" -C "$tmpdir"
  root="$(resolve_extracted_bundle_root "$tmpdir")"

  runtime_source="$root/bin/redevplugin-runtime"
  if [[ ! -f "$runtime_source" && -f "$root/bin/redevplugin-runtime.exe" ]]; then
    runtime_source="$root/bin/redevplugin-runtime.exe"
  fi
  if [[ ! -f "$runtime_source" ]]; then
    die "verified runtime tarball does not contain bin/redevplugin-runtime"
  fi

  runtime_dir=$(dirname -- "$runtime_out")
  mkdir -p "$runtime_dir"
  cp "$runtime_source" "$runtime_out"
  chmod +x "$runtime_out"

  cp "$marker" "$runtime_dir/$MARKER_BASENAME"
  if [[ -n "$MARKER_OUT" ]]; then
    mkdir -p "$(dirname -- "$MARKER_OUT")"
    cp "$marker" "$MARKER_OUT"
  fi
  rm -rf "$tmpdir"
  "$SCRIPT_DIR/check_redevplugin_consumption_gate.sh" --scan-root "$runtime_dir"
  log "ReDevPlugin runtime staged: $runtime_out"
}

run_stage() {
  if [[ -z "$DEST_DIR" ]]; then
    usage >&2
    exit 2
  fi
  if [[ -z "$SOURCE_DIR" && -z "$VERSION" ]]; then
    usage >&2
    exit 2
  fi
  if [[ -n "$VERSION" ]]; then
    assert_release_tag "$VERSION"
  fi
  if [[ -n "$REDEVEN_GOOS$REDEVEN_GOARCH" ]]; then
    if [[ -z "$REDEVEN_GOOS" || -z "$REDEVEN_GOARCH" ]]; then
      die "--redeven-goos and --redeven-goarch must be provided together"
    fi
    if [[ -n "$RUNTIME_TARGET" ]]; then
      die "--runtime-target cannot be combined with --redeven-goos/--redeven-goarch"
    fi
    if [[ -z "$RUNTIME_OUT" ]]; then
      die "--redeven-goos/--redeven-goarch require --runtime-out"
    fi
    RUNTIME_TARGET="$(resolve_redevplugin_runtime_target "$REDEVEN_GOOS" "$REDEVEN_GOARCH")"
  fi
  if [[ -n "$RUNTIME_TARGET" && -z "$RUNTIME_OUT" ]] || [[ -z "$RUNTIME_TARGET" && -n "$RUNTIME_OUT" ]]; then
    die "--runtime-target and --runtime-out must be provided together"
  fi

  prepare_dest_dir "$DEST_DIR"
  if [[ -n "$SOURCE_DIR" ]]; then
    copy_source_artifacts "$SOURCE_DIR" "$DEST_DIR"
  else
    download_release_artifacts "$VERSION" "$REPO" "$DEST_DIR"
  fi

  verify_staged_artifacts "$DEST_DIR"

  if [[ -n "$RUNTIME_TARGET" ]]; then
    extract_runtime_binary "$DEST_DIR" "$VERSION" "$RUNTIME_TARGET" "$RUNTIME_OUT"
  elif [[ -n "$MARKER_OUT" ]]; then
    mkdir -p "$(dirname -- "$MARKER_OUT")"
    cp "$DEST_DIR/$MARKER_BASENAME" "$MARKER_OUT"
  fi

  log "ReDevPlugin release artifacts staged: $DEST_DIR"
}

write_self_test_bundle_manifest() {
  local bundle_dir="$1"
  local version="$2"
  local target="$3"

  SELF_TEST_BUNDLE_DIR="$bundle_dir" SELF_TEST_VERSION="$version" SELF_TEST_TARGET="$target" node <<'NODE'
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = process.env.SELF_TEST_BUNDLE_DIR;
const files = [];
walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(root, "release-manifest.json"), `${JSON.stringify({
  schema_version: "redevplugin.release_manifest.v1",
  version: process.env.SELF_TEST_VERSION,
  runtime_target: process.env.SELF_TEST_TARGET,
  generated_at: "2026-07-03T00:00:00Z",
  files,
}, null, 2)}\n`);
writeFileSync(join(root, "SHA256SUMS"), `${files.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`);

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
}

write_self_test_stress_summary() {
  local path="$1"
  cat >"$path" <<'JSON'
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
}

create_self_test_artifacts() {
  local source_dir="$1"
  local version="$2"
  local target="$3"
  local bundle_parent="$source_dir/bundles"
  local bundle_name="redevplugin-${version}-${target}"
  local bundle_dir="$bundle_parent/$bundle_name"

  mkdir -p "$bundle_dir/bin" "$bundle_dir/contracts/spec/plugin"
  printf 'self-test runtime\n' >"$bundle_dir/bin/redevplugin-runtime"
  printf 'self-test cli\n' >"$bundle_dir/bin/redevplugin"
  chmod +x "$bundle_dir/bin/redevplugin-runtime" "$bundle_dir/bin/redevplugin"
  printf '{}\n' >"$bundle_dir/contracts/spec/plugin/release-manifest-v1.schema.json"
  cat >"$bundle_dir/compatibility.json" <<JSON
{
  "schema_version": "redevplugin.compatibility.v1",
  "matrix": {
    "redevplugin_go_version": "${version}",
    "redevplugin_ui_version": "${version}",
    "redevplugin_runtime_version": "${version}",
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
  write_self_test_bundle_manifest "$bundle_dir" "$version" "$target"
  tar -C "$bundle_parent" -czf "$source_dir/${bundle_name}.tar.gz" "$bundle_name"
  write_self_test_stress_summary "$source_dir/redevplugin-release-stress.json"
  (
    cd "$source_dir"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "${bundle_name}.tar.gz" redevplugin-release-stress.json >SHA256SUMS
    else
      shasum -a 256 "${bundle_name}.tar.gz" redevplugin-release-stress.json | awk '{ print $1 "  " $2 }' >SHA256SUMS
    fi
    for file in "${bundle_name}.tar.gz" redevplugin-release-stress.json SHA256SUMS; do
      printf 'fixture signature\n' >"${file}.sig"
      printf 'fixture bundle\n' >"${file}.bundle"
    done
  )
  rm -rf "$bundle_parent"
}

if [[ "$SELF_TEST" -eq 1 ]]; then
  if [[ -n "$SOURCE_DIR$DEST_DIR$RUNTIME_TARGET$RUNTIME_OUT$MARKER_OUT" ]]; then
    echo "--self-test cannot be combined with staging arguments" >&2
    exit 2
  fi
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT
  source_dir="$tmpdir/source"
  dest_dir="$tmpdir/staged"
  runtime_out="$tmpdir/runtime/redevplugin-runtime"
  marker_out="$tmpdir/marker/$MARKER_BASENAME"
  version="v0.0.0-test"
  target="x86_64-unknown-linux-gnu"
  mkdir -p "$source_dir"
  create_self_test_artifacts "$source_dir" "$version" "$target"

  "$0" \
    --source-dir "$source_dir" \
    --dest-dir "$dest_dir" \
    --version "$version" \
    --redeven-goos linux \
    --redeven-goarch amd64 \
    --runtime-out "$runtime_out" \
    --marker-out "$marker_out" \
    --skip-cosign

  if [[ ! -x "$runtime_out" ]]; then
    echo "self-test expected extracted runtime to be executable" >&2
    exit 1
  fi
  if [[ ! -s "$dest_dir/$MARKER_BASENAME" || ! -s "$(dirname -- "$runtime_out")/$MARKER_BASENAME" || ! -s "$marker_out" ]]; then
    echo "self-test expected verifier markers to be written" >&2
    exit 1
  fi
  if ! cmp -s "$runtime_out" <(printf 'self-test runtime\n'); then
    echo "self-test extracted runtime content mismatch" >&2
    exit 1
  fi

  bad_source="$tmpdir/bad-source"
  cp -R "$source_dir" "$bad_source"
  rm -f "$bad_source/SHA256SUMS.bundle"
  if "$0" --source-dir "$bad_source" --dest-dir "$tmpdir/bad-staged" --version "$version" --skip-cosign >/dev/null 2>&1; then
    echo "self-test expected missing signature evidence to fail" >&2
    exit 1
  fi
  if "$0" \
    --source-dir "$source_dir" \
    --dest-dir "$tmpdir/bad-target-staged" \
    --version "$version" \
    --redeven-goos linux \
    --redeven-goarch riscv64 \
    --runtime-out "$tmpdir/bad-target-runtime" \
    --skip-cosign >/dev/null 2>&1; then
    echo "self-test expected unsupported Redeven target to fail" >&2
    exit 1
  fi
  exit 0
fi

run_stage
