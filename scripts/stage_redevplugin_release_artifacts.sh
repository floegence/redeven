#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
REPOSITORY="floegence/redevplugin"
RUST_TOOLCHAIN="1.88.0"
PUBLICATION_ASSET="platform-package-publication-v1.json"
PUBLICATION_MARKER="platform-publication-verification-v1.json"
RUNTIME_MARKER=".redevplugin-release-artifacts-verified.json"
RUNTIME_NOTICES="REDEVPLUGIN_THIRD_PARTY_NOTICES.md"
RUNTIME_SBOM="REDEVPLUGIN_RUNTIME.spdx.json"
RUNTIME_PROVENANCE="redevplugin-runtime.provenance.json"
RUNTIME_SIGNATURE="redevplugin-runtime.sig"
RUNTIME_CERTIFICATE="redevplugin-runtime.pem"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/stage_redevplugin_release_artifacts.sh \
    --dest-dir <dir> --redeven-goos linux --redeven-goarch <amd64|arm64> \
    --runtime-out <file> [--profile development|release]
  ./scripts/stage_redevplugin_release_artifacts.sh --self-test

Downloads and verifies the released ReDevPlugin package publication, builds the
runtime from the exact published Rust source crate with Rust 1.88.0, and emits
Redeven-owned SBOM, provenance, notices, signature, and verification evidence.
Only linux/amd64 and linux/arm64 are supported runtime targets.
USAGE
}

dest_dir=""
goos=""
goarch=""
runtime_out=""
profile="development"
self_test=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest-dir) dest_dir="${2:-}"; shift 2 ;;
    --redeven-goos) goos="${2:-}"; shift 2 ;;
    --redeven-goarch) goarch="${2:-}"; shift 2 ;;
    --runtime-out) runtime_out="${2:-}"; shift 2 ;;
    --profile) profile="${2:-}"; shift 2 ;;
    --self-test) self_test=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unexpected argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() {
  echo "[redevplugin-stage] $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

if [[ "$self_test" -eq 1 ]]; then
  [[ -z "$dest_dir$goos$goarch$runtime_out" && "$profile" == "development" ]] ||
    die "--self-test cannot be combined with staging arguments"
  exec node --test "$SCRIPT_DIR/redevplugin_release_contract.test.mjs"
fi

[[ -n "$dest_dir" && -n "$runtime_out" && -n "$goos" && -n "$goarch" ]] || { usage >&2; exit 2; }
[[ "$profile" == "development" || "$profile" == "release" ]] || die "unsupported build profile: $profile"
target="$goos/$goarch"
case "$target" in
  linux/amd64) rust_target="x86_64-unknown-linux-gnu" ;;
  linux/arm64) rust_target="aarch64-unknown-linux-gnu" ;;
  *) die "unsupported ReDevPlugin runtime target: $target" ;;
esac

for command in cargo gh go jq node readelf rustc rustup; do require_command "$command"; done
if [[ "$profile" == "release" ]]; then
  require_command cosign
  [[ "${GITHUB_REPOSITORY:-}" == "floegence/redeven" ]] || die "release build requires the floegence/redeven workflow identity"
  [[ "${GITHUB_REF:-}" =~ ^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "release build requires a stable Redeven tag ref"
  [[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die "release build requires the exact Redeven source commit"
  product_ref="$GITHUB_REF"
  product_commit="$GITHUB_SHA"
else
  product_commit=$(git -C "$ROOT_DIR" rev-parse HEAD)
  branch=$(git -C "$ROOT_DIR" branch --show-current)
  [[ -n "$branch" ]] || branch="detached/$product_commit"
  product_ref="refs/heads/$branch"
fi

dest_parent=$(dirname -- "$dest_dir")
runtime_parent=$(dirname -- "$runtime_out")
mkdir -p "$dest_parent" "$runtime_parent"
dest_parent=$(cd -- "$dest_parent" >/dev/null 2>&1 && pwd -P)
runtime_parent=$(cd -- "$runtime_parent" >/dev/null 2>&1 && pwd -P)
dest_dir="$dest_parent/$(basename -- "$dest_dir")"
runtime_out="$runtime_parent/$(basename -- "$runtime_out")"
[[ ! -e "$dest_dir" && ! -L "$dest_dir" ]] || die "destination already exists: $dest_dir"
[[ ! -e "$runtime_out" && ! -L "$runtime_out" ]] || die "runtime output already exists: $runtime_out"

tmpdir=$(mktemp -d "$dest_parent/.redevplugin-stage.XXXXXX")
trap 'rm -rf "$tmpdir"' EXIT
package_set="$tmpdir/package-set.json"
(cd "$ROOT_DIR" && GOWORK=off go run ./scripts/read_redevplugin_package_set.go >"$package_set")
version=$(jq -er '.platform_version' "$package_set")
tag="v$version"

mkdir -p "$tmpdir/upstream"
gh release download "$tag" --repo "$REPOSITORY" --dir "$tmpdir/upstream" --pattern "$PUBLICATION_ASSET"
publication="$tmpdir/upstream/$PUBLICATION_ASSET"
publication_verification="$tmpdir/$PUBLICATION_MARKER"
"$SCRIPT_DIR/check_redevplugin_release_artifacts.sh" \
  --artifact-dir "$tmpdir/upstream" \
  --tag "$tag" \
  --write-marker "$publication_verification"

rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal
rustup target add --toolchain "$RUST_TOOLCHAIN" "$rust_target"
cargo_version=$(rustup run "$RUST_TOOLCHAIN" cargo --version)
rustc_version=$(rustup run "$RUST_TOOLCHAIN" rustc --version)

export CARGO_HOME="$tmpdir/cargo-home"
install_root="$tmpdir/runtime-install"
rustflags_key="CARGO_TARGET_$(printf '%s' "$rust_target" | tr '[:lower:]-' '[:upper:]_')_RUSTFLAGS"
env "$rustflags_key=-C target-feature=+crt-static -C relocation-model=pic -C linker=$SCRIPT_DIR/link_redevplugin_runtime_static_pie.sh" \
  rustup run "$RUST_TOOLCHAIN" cargo install \
  --locked \
  --root "$install_root" \
  --target "$rust_target" \
  --version "=$version" \
  redevplugin-runtime

mapfile -t runtime_sources < <(find "$CARGO_HOME/registry/src" \
  -mindepth 2 -maxdepth 2 -type d -name "redevplugin-runtime-$version" -print)
[[ "${#runtime_sources[@]}" -eq 1 ]] || die "Cargo cache does not contain one exact published runtime source"
runtime_source="${runtime_sources[0]}"
[[ ! -L "$runtime_source" && -f "$runtime_source/Cargo.toml" && -f "$runtime_source/Cargo.lock" ]] ||
  die "published runtime source is missing its locked Cargo manifest"
rustup run "$RUST_TOOLCHAIN" cargo metadata \
  --format-version 1 \
  --locked \
  --filter-platform "$rust_target" \
  --manifest-path "$runtime_source/Cargo.toml" >"$tmpdir/cargo-metadata.json"

runtime="$tmpdir/redevplugin-runtime"
install -m 0755 "$install_root/bin/redevplugin-runtime" "$runtime"
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-elf "$runtime" "$target"
if readelf -lW "$runtime" | grep -q '[[:space:]]INTERP[[:space:]]'; then
  die "ReDevPlugin runtime ELF interpreter is forbidden"
fi
if readelf -dW "$runtime" | grep -q '[[:space:]]NEEDED[[:space:]]'; then
  die "ReDevPlugin runtime dynamic dependencies are forbidden"
fi

provenance="$tmpdir/$RUNTIME_PROVENANCE"
sbom="$tmpdir/$RUNTIME_SBOM"
notices="$tmpdir/$RUNTIME_NOTICES"
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" write-build-evidence \
  --package-set "$package_set" \
  --publication-verification "$publication_verification" \
  --cargo-metadata "$tmpdir/cargo-metadata.json" \
  --product-repository floegence/redeven \
  --product-workflow .github/workflows/release.yml \
  --product-ref "$product_ref" \
  --product-commit "$product_commit" \
  --target "$target" \
  --runtime "$runtime" \
  --provenance-out "$provenance" \
  --sbom-out "$sbom" \
  --notices-out "$notices"

signature="$tmpdir/$RUNTIME_SIGNATURE"
certificate="$tmpdir/$RUNTIME_CERTIFICATE"
if [[ "$profile" == "release" ]]; then
  cosign sign-blob --yes \
    --output-signature "$signature" \
    --output-certificate "$certificate" \
    "$runtime"
else
  RUNTIME="$runtime" SIGNATURE="$signature" CERTIFICATE="$certificate" node --input-type=module <<'NODE'
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const keys = generateKeyPairSync('ed25519');
writeFileSync(process.env.SIGNATURE, sign(null, readFileSync(process.env.RUNTIME), keys.privateKey), { flag: 'wx', mode: 0o644 });
writeFileSync(process.env.CERTIFICATE, keys.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o644 });
NODE
fi

marker="$tmpdir/$RUNTIME_MARKER"
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" write-runtime-marker \
  --profile "$profile" \
  --package-set "$package_set" \
  --publication-verification "$publication_verification" \
  --product-repository floegence/redeven \
  --product-workflow .github/workflows/release.yml \
  --product-ref "$product_ref" \
  --product-commit "$product_commit" \
  --target "$target" \
  --runtime "$runtime" \
  --sbom "$sbom" \
  --provenance "$provenance" \
  --notices "$notices" \
  --signature "$signature" \
  --certificate "$certificate" \
  --cargo-version "$cargo_version" \
  --rustc-version "$rustc_version" \
  --out "$marker"

staged="$tmpdir/published"
mkdir -p "$staged"
install -m 0644 "$publication" "$staged/$PUBLICATION_ASSET"
install -m 0644 "$publication_verification" "$staged/$PUBLICATION_MARKER"
install -m 0644 "$package_set" "$staged/platform-package-set-v1.json"
install -m 0755 "$runtime" "$staged/redevplugin-runtime"
for name in "$RUNTIME_MARKER" "$RUNTIME_NOTICES" "$RUNTIME_SBOM" "$RUNTIME_PROVENANCE" "$RUNTIME_SIGNATURE" "$RUNTIME_CERTIFICATE"; do
  install -m 0644 "$tmpdir/$name" "$staged/$name"
done
mv "$staged" "$dest_dir"

install -m 0755 "$dest_dir/redevplugin-runtime" "$runtime_out"
for name in "$RUNTIME_MARKER" "$RUNTIME_NOTICES" "$RUNTIME_SBOM" "$RUNTIME_PROVENANCE" "$RUNTIME_SIGNATURE" "$RUNTIME_CERTIFICATE"; do
  output="$runtime_parent/$name"
  [[ ! -e "$output" && ! -L "$output" ]] || die "runtime evidence output already exists: $output"
  install -m 0644 "$dest_dir/$name" "$output"
done

rm -rf "$tmpdir"
trap - EXIT
echo "[INFO] Redeven-built ReDevPlugin $version runtime staged for $target"
