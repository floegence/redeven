#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
RUNTIME_MARKER=".redevplugin-release-artifacts-verified.json"
RUNTIME_NOTICES="REDEVPLUGIN_THIRD_PARTY_NOTICES.md"
RUNTIME_SBOM="REDEVPLUGIN_RUNTIME.spdx.json"
RUNTIME_PROVENANCE="redevplugin-runtime.provenance.json"
RUNTIME_SIGNATURE="redevplugin-runtime.sig"
RUNTIME_CERTIFICATE="redevplugin-runtime.pem"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_redevplugin_consumption_gate.sh --scan-root <dir> [--scan-root <dir> ...]
    [--runtime-target <goos/arch>] [--require-release]
  ./scripts/check_redevplugin_consumption_gate.sh --self-test

Validates every Redeven-built ReDevPlugin runtime and its package publication,
SBOM, provenance, notices, and signature. Runtime payloads are accepted only for
linux/amd64 and linux/arm64; Darwin payloads must omit ReDevPlugin runtime files.
USAGE
}

scan_roots=()
runtime_target=""
require_release=0
self_test=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scan-root) scan_roots+=("${2:-}"); shift 2 ;;
    --runtime-target) runtime_target="${2:-}"; shift 2 ;;
    --require-release) require_release=1; shift ;;
    --self-test) self_test=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unexpected argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() {
  echo "[redevplugin-consumption] $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

if [[ "$self_test" -eq 1 ]]; then
  [[ "${#scan_roots[@]}" -eq 0 && -z "$runtime_target" && "$require_release" -eq 0 ]] ||
    die "--self-test cannot be combined with scan arguments"
  exec node --test "$SCRIPT_DIR/redevplugin_release_contract.test.mjs" "$SCRIPT_DIR/redevplugin_consumption_gate.test.mjs"
fi

[[ "${#scan_roots[@]}" -gt 0 ]] || { usage >&2; exit 2; }
if [[ "${#scan_roots[@]}" -ne 1 && -n "$runtime_target" ]]; then
  die "--runtime-target requires exactly one --scan-root"
fi
if [[ -n "$runtime_target" ]]; then
  case "$runtime_target" in
    linux/amd64|linux/arm64|darwin/amd64|darwin/arm64) ;;
    *) die "unsupported scan target: $runtime_target" ;;
  esac
fi
for command in jq node python3; do require_command "$command"; done

verify_signature() {
  local root="$1"
  local profile identity issuer
  profile=$(jq -er '.profile' "$root/$RUNTIME_MARKER")
  if [[ "$profile" == "release" ]]; then
    require_command cosign
    identity=$(jq -er '.runtime.signature.certificate_identity' "$root/$RUNTIME_MARKER")
    issuer=$(jq -er '.runtime.signature.oidc_issuer' "$root/$RUNTIME_MARKER")
    cosign verify-blob \
      --certificate "$root/$RUNTIME_CERTIFICATE" \
      --signature "$root/$RUNTIME_SIGNATURE" \
      --certificate-identity "$identity" \
      --certificate-oidc-issuer "$issuer" \
      "$root/redevplugin-runtime" >/dev/null
  else
    ROOT="$root" node --input-type=module <<'NODE'
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.ROOT;
const valid = verify(
  null,
  readFileSync(join(root, 'redevplugin-runtime')),
  createPublicKey(readFileSync(join(root, 'redevplugin-runtime.pem'))),
  readFileSync(join(root, 'redevplugin-runtime.sig')),
);
if (!valid) throw new Error('local ReDevPlugin runtime signature is invalid');
NODE
  fi
}

assert_absent_for_darwin() {
  local root="$1"
  for name in redevplugin-runtime "$RUNTIME_MARKER" "$RUNTIME_NOTICES" "$RUNTIME_SBOM" \
    "$RUNTIME_PROVENANCE" "$RUNTIME_SIGNATURE" "$RUNTIME_CERTIFICATE"; do
    if [[ -e "$root/$name" || -L "$root/$name" ]]; then
      echo "[redevplugin-consumption] Darwin payload must not contain $name" >&2
      return 1
    fi
  done
}

verify_runtime_directory() {
  local root="$1"
  local target="$2"
  local require_flag="false"
  [[ "$require_release" -eq 0 ]] || require_flag="true"
  if ! node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-runtime-directory \
    --root "$root" \
    --target "$target" \
    --require-release "$require_flag"; then
    return 1
  fi
  verify_signature "$root"
}

scan_root() {
  local root="$1"
  local direct_target="$2"
  local archive target goos goarch extract_parent extracted archive_count=0 direct_count=0
  [[ -d "$root" && ! -L "$root" ]] || die "scan root must be a real directory: $root"
  root=$(cd -- "$root" >/dev/null 2>&1 && pwd -P)

  if [[ -e "$root/redevplugin-runtime" || -L "$root/redevplugin-runtime" || -e "$root/$RUNTIME_MARKER" || -L "$root/$RUNTIME_MARKER" ]]; then
    [[ -n "$direct_target" ]] || die "direct ReDevPlugin runtime requires --runtime-target"
    case "$direct_target" in
      linux/amd64|linux/arm64) verify_runtime_directory "$root" "$direct_target" ;;
      darwin/amd64|darwin/arm64) assert_absent_for_darwin "$root" ;;
    esac
    direct_count=1
  elif [[ "$direct_target" == darwin/* ]]; then
    assert_absent_for_darwin "$root"
    direct_count=1
  fi

  while IFS= read -r archive; do
    [[ -n "$archive" ]] || continue
    archive_count=$((archive_count + 1))
    case "$(basename -- "$archive")" in
      redeven_linux_amd64.tar.gz) target="linux/amd64" ;;
      redeven_linux_arm64.tar.gz) target="linux/arm64" ;;
      redeven_darwin_amd64.tar.gz) target="darwin/amd64" ;;
      redeven_darwin_arm64.tar.gz) target="darwin/arm64" ;;
      *) die "Redeven runtime archive has no closed target identity: $archive" ;;
    esac
    extract_parent=$(mktemp -d)
    extracted="$extract_parent/payload"
    goos=${target%/*}
    goarch=${target#*/}
    if [[ "$goos" == "linux" ]]; then
      if ! "$SCRIPT_DIR/safe_extract_tar.py" \
        --archive "$archive" \
        --dest "$extracted" \
        --allow-file redeven \
        --allow-file redevplugin-runtime \
        --allow-file "$RUNTIME_MARKER" \
        --allow-file "$RUNTIME_NOTICES" \
        --allow-file "$RUNTIME_SBOM" \
        --allow-file "$RUNTIME_PROVENANCE" \
        --allow-file "$RUNTIME_SIGNATURE" \
        --allow-file "$RUNTIME_CERTIFICATE" \
        --allow-file LICENSE \
        --allow-file THIRD_PARTY_NOTICES.md \
        --max-files 10 \
        --max-total-bytes 536870912; then
        rm -rf "$extract_parent"
        die "Linux runtime archive failed controlled extraction: $archive"
      fi
      if ! verify_runtime_directory "$extracted" "$target"; then
        rm -rf "$extract_parent"
        die "Linux runtime archive evidence is invalid: $archive"
      fi
    else
      if ! "$SCRIPT_DIR/safe_extract_tar.py" \
        --archive "$archive" \
        --dest "$extracted" \
        --allow-file redeven \
        --allow-file LICENSE \
        --allow-file THIRD_PARTY_NOTICES.md \
        --max-files 3 \
        --max-total-bytes 536870912; then
        rm -rf "$extract_parent"
        die "Darwin runtime archive failed controlled extraction: $archive"
      fi
      if ! assert_absent_for_darwin "$extracted"; then
        rm -rf "$extract_parent"
        die "Darwin runtime archive contains forbidden plugin runtime evidence: $archive"
      fi
    fi
    rm -rf "$extract_parent"
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type f -name 'redeven_*.tar.gz' -print | sort)

  if find "$root" -mindepth 2 -type f \( -name redevplugin-runtime -o -name "$RUNTIME_MARKER" \) -print -quit | grep -q .; then
    die "nested unpacked ReDevPlugin payload is outside the verified runtime directory"
  fi
  if find "$root" -mindepth 1 -maxdepth 1 -type f -name 'redevplugin-v*.tar.gz' -print -quit | grep -q .; then
    die "legacy upstream-built ReDevPlugin runtime archive is forbidden"
  fi
  if [[ "$archive_count" -eq 0 && "$direct_count" -eq 0 ]]; then
    die "scan root contains no verifiable ReDevPlugin runtime policy surface"
  fi
}

for root in "${scan_roots[@]}"; do scan_root "$root" "$runtime_target"; done
echo "[INFO] ReDevPlugin consumption gate passed"
