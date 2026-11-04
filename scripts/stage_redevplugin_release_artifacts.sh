#!/usr/bin/env bash
set -Eeuo pipefail
stage_phase=validation_failed
trap 'printf "[redevplugin-stage:%s] Runtime preparation failed\n" "$stage_phase" >&2' ERR

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
REPOSITORY="floegence/redevplugin"
RUST_TOOLCHAIN=$(node -p 'require(process.argv[1]).rust' "$SCRIPT_DIR/redevplugin_build_toolchain.json")
RELEASE_MANIFEST_ASSET="platform-release-manifest.json"
RELEASE_VERIFICATION="redevplugin-release-verification-v1.json"
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
    --dest-dir <dir> --redeven-goos <linux|darwin> --redeven-goarch <amd64|arm64> \
    --runtime-out <file> [--profile development|release]
    [--manifest-file <file>]
  ./scripts/stage_redevplugin_release_artifacts.sh --self-test

Downloads and verifies the released ReDevPlugin platform manifest, builds the
runtime from the exact published Rust source crate with Rust 1.98.0, and emits
Redeven-owned SBOM, provenance, notices, signature, and verification evidence.
The closed runtime target set is linux/amd64, linux/arm64, darwin/amd64, and
darwin/arm64. Manifest downloads retry TLS/network failures up to three times,
with a 15-second connection timeout, 60-second transfer timeout, and 120-second
retry window. HTTPS and certificate verification remain required.
Development launches may set REDEVEN_REDEVPLUGIN_BUILD_CACHE to an absolute
profile-owned cache. Release staging always uses isolated Cargo directories.
Rustup reuses installed components and recovers transient network
failures with bounded retries. Set REDEVEN_RUSTUP_OFFLINE=1 for explicit
Rustup cache-only preparation; set REDEVEN_RUSTUP_MAX_ATTEMPTS or
REDEVEN_RUSTUP_RETRY_DELAY_SECONDS to tune the bounded retry policy.
The unified build preparer also verifies a pinned Zig 0.16.0 archive for macOS
Linux builds and tests target C compilation, archiving and static PIE linkage.
REDEVEN_REDEVPLUGIN_TOOLCHAIN_CACHE selects its absolute cache directory;
REDEVEN_TOOLCHAIN_OFFLINE=1 requires complete cached build tools. CC/AR settings
are target-scoped and never exported to the user's shell.
USAGE
}

dest_dir=""
goos=""
goarch=""
runtime_out=""
manifest_file=""
profile="development"
self_test=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest-dir) dest_dir="${2:-}"; shift 2 ;;
    --redeven-goos) goos="${2:-}"; shift 2 ;;
    --redeven-goarch) goarch="${2:-}"; shift 2 ;;
    --runtime-out) runtime_out="${2:-}"; shift 2 ;;
    --manifest-file) manifest_file="${2:-}"; shift 2 ;;
    --profile) profile="${2:-}"; shift 2 ;;
    --self-test) self_test=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unexpected argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() {
  echo "[redevplugin-stage:$stage_phase] $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

if [[ "$self_test" -eq 1 ]]; then
  [[ -z "$dest_dir$goos$goarch$runtime_out$manifest_file" && "$profile" == "development" ]] ||
    die "--self-test cannot be combined with staging arguments"
  exec node --test \
    "$SCRIPT_DIR/redevplugin_release_contract.test.mjs" \
    "$SCRIPT_DIR/redevplugin_manifest_download.test.mjs" \
    "$SCRIPT_DIR/redevplugin_rust_toolchain.test.mjs" \
    "$SCRIPT_DIR/redevplugin_build_toolchain.test.mjs" \
    "$SCRIPT_DIR/redevplugin_macos_signature.test.mjs"
fi

[[ -n "$dest_dir" && -n "$runtime_out" && -n "$goos" && -n "$goarch" ]] || { usage >&2; exit 2; }
[[ "$profile" == "development" || "$profile" == "release" ]] || die "unsupported build profile: $profile"
target="$goos/$goarch"
case "$target" in
  linux/amd64|linux/arm64|darwin/amd64|darwin/arm64) ;;
  *) die "unsupported ReDevPlugin runtime target: $target" ;;
esac

for command in cargo go node rustc rustup; do require_command "$command"; done
if [[ "$goos" == "darwin" ]]; then require_command codesign; require_command python3; fi
if [[ -z "$manifest_file" || "$profile" == "release" ]]; then
  require_command curl
  require_command jq
fi

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
trap 'exit 130' INT
trap 'exit 143' TERM
tag=$(cd "$ROOT_DIR" && GOWORK=off go list -m -f '{{.Version}}' github.com/floegence/redevplugin/v3)
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid ReDevPlugin module version: $tag"

mkdir -p "$tmpdir/upstream"
if [[ -n "$manifest_file" ]]; then
  [[ -f "$manifest_file" && ! -L "$manifest_file" ]] || die "manifest file is missing: $manifest_file"
  manifest=$(cd -- "$(dirname -- "$manifest_file")" >/dev/null 2>&1 && pwd -P)/$(basename -- "$manifest_file")
  node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-release-manifest "$manifest" "$tag" >/dev/null
  version=$(node --input-type=module -e "import { readFileSync } from 'node:fs'; process.stdout.write(JSON.parse(readFileSync(process.argv[1], 'utf8')).platform_version);" "$manifest")
  install -m 0644 "$manifest" "$tmpdir/upstream/$RELEASE_MANIFEST_ASSET"
  manifest="$tmpdir/upstream/$RELEASE_MANIFEST_ASSET"
  if [[ "$profile" == "release" ]]; then
    "$SCRIPT_DIR/check_redevplugin_release_artifacts.sh" \
      --artifact-dir "$tmpdir/upstream" \
      --tag "$tag"
  fi
else
  # curl's ordinary retry policy excludes TLS handshake errors (exit 35).
  # This is a replayable GET into staging; retry all transfer errors with limits.
  stage_phase=download_failed
  if ! curl --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --fail --silent --show-error --location \
    --retry 3 --retry-all-errors --retry-max-time 120 \
    --connect-timeout 15 --max-time 60 \
    "https://github.com/$REPOSITORY/releases/download/$tag/$RELEASE_MANIFEST_ASSET" \
    --output "$tmpdir/upstream/$RELEASE_MANIFEST_ASSET"
  then
    die "failed to download ReDevPlugin $tag release manifest after bounded retries; check GitHub connectivity and HTTPS_PROXY, then retry"
  fi
  stage_phase=validation_failed
  manifest="$tmpdir/upstream/$RELEASE_MANIFEST_ASSET"
  version=$(node --input-type=module -e "import { readFileSync } from 'node:fs'; process.stdout.write(JSON.parse(readFileSync(process.argv[1], 'utf8')).platform_version);" "$manifest")
  [[ "v$version" == "$tag" ]] || die "release manifest version does not match Go module version"
  if [[ "$profile" == "release" ]]; then
    "$SCRIPT_DIR/check_redevplugin_release_artifacts.sh" \
      --artifact-dir "$tmpdir/upstream" \
      --tag "$tag"
  fi
fi
release_verification="$tmpdir/$RELEASE_VERIFICATION"
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" write-release-verification \
  "$manifest" "$tag" "$release_verification"

# Cargo verifies the registry checksum while downloading the crate. Re-check
# the exact cached crate against the published manifest before building it so
# development staging keeps the same provenance boundary as release staging.
expected_runtime_crate_sha=$(REDEVEN_PLUGIN_MANIFEST="$manifest" node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(process.env.REDEVEN_PLUGIN_MANIFEST, 'utf8'));
const artifact = manifest.artifacts?.find((item) => item?.name === 'crate:redevplugin-runtime');
if (!/^[a-f0-9]{64}$/.test(artifact?.sha256 ?? '')) {
  throw new Error('release manifest is missing the redevplugin-runtime crate digest');
}
process.stdout.write(artifact.sha256);
NODE
)

stage_phase=toolchain_failed
# One owner prepares Rust, target C compilation/archiving and a real link probe.
toolchain_file="$tmpdir/build-toolchain.json"
node "$SCRIPT_DIR/prepare_redevplugin_build_toolchain.mjs" --goos "$goos" --goarch "$goarch" >"$toolchain_file"
toolchain_cargo=$(node -p 'require(process.argv[1]).cargo' "$toolchain_file")
rust_target=$(node -p 'require(process.argv[1]).rust_target' "$toolchain_file")
toolchain_identity=$(node -p 'require(process.argv[1]).identity' "$toolchain_file")
build_environment=()
while IFS= read -r entry; do build_environment+=("$entry"); done < <(node -e '
  for (const [key,value] of Object.entries(require(process.argv[1]).env)) console.log(`${key}=${value}`);
' "$toolchain_file")
toolchain_root=$(cd -- "$(dirname -- "$toolchain_cargo")/.." >/dev/null 2>&1 && pwd -P)
toolchain_rustc="$toolchain_root/bin/rustc"
cargo_version=$("$toolchain_cargo" --version)
rustc_version=$("$toolchain_rustc" --version)
stage_phase=validation_failed

# Only development launches opt into a profile-owned Cargo download/build cache.
# Cargo still installs into a fresh root with --locked, and the crate digest,
# executable, signature and product provenance are verified/generated each time.
if [[ "$profile" == development && -n "${REDEVEN_REDEVPLUGIN_BUILD_CACHE:-}" ]]; then
  case "$REDEVEN_REDEVPLUGIN_BUILD_CACHE" in /*) ;; *) die "ReDevPlugin build cache must be absolute" ;; esac
  cache_key=$(node -e '
    const fs=require("node:fs"), crypto=require("node:crypto");
    const h=crypto.createHash("sha256");
    for(const file of process.argv.slice(1,5)) h.update(fs.readFileSync(file));
    h.update(JSON.stringify(process.argv.slice(5)));
    process.stdout.write(h.digest("hex"));
  ' "$SCRIPT_DIR/stage_redevplugin_release_artifacts.sh" "$SCRIPT_DIR/link_redevplugin_runtime_static_pie.sh" \
    "$SCRIPT_DIR/redevplugin-runtime-entitlements.plist" "$SCRIPT_DIR/verify_redevplugin_macos_signature.py" \
    "$expected_runtime_crate_sha" "$cargo_version" "$rustc_version" "$toolchain_identity")
  cache_root="$REDEVEN_REDEVPLUGIN_BUILD_CACHE/$RUST_TOOLCHAIN/$rust_target/$cache_key"
  mkdir -p "$cache_root/cargo-home" "$cache_root/target"
  export CARGO_HOME="$cache_root/cargo-home"
  export CARGO_TARGET_DIR="$cache_root/target"
  echo "[redevplugin-stage] Reusing development Cargo cache: $cache_root"
  cached_sources=()
  if [[ -d "$CARGO_HOME/registry/src" ]]; then
    while IFS= read -r candidate; do cached_sources+=("$candidate"); done < <(find "$CARGO_HOME/registry/src" -mindepth 2 -maxdepth 2 -type d -name "redevplugin-runtime-$version" -print)
  fi
  if [[ "${#cached_sources[@]}" -eq 1 ]]; then
    cached_source="${cached_sources[0]}"
    cached_archive="$CARGO_HOME/registry/cache/$(basename -- "$(dirname -- "$cached_source")")/redevplugin-runtime-$version.crate"
    if [[ -f "$cached_archive" && ! -L "$cached_archive" ]]; then
      cached_digest=$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))' "$cached_archive")
      [[ "$cached_digest" == "$expected_runtime_crate_sha" ]] || die "cached runtime crate digest does not match the published release manifest"
      # Resolve the locked dependency graph locally before selecting offline
      # installation. A partial cache may download; compiler failures never retry.
      if PATH="$toolchain_root/bin:$PATH" "$toolchain_cargo" metadata --offline --locked \
        --format-version 1 --filter-platform "$rust_target" \
        --manifest-path "$cached_source/Cargo.toml" >"$tmpdir/offline-metadata.json" 2>"$tmpdir/offline-metadata.log"; then
        export CARGO_NET_OFFLINE=true
        echo "[redevplugin-stage] Verified locked dependencies are cached; building without registry requests."
      else
        echo "[redevplugin-stage] Offline dependency check failed; preparing the exact locked crate with the configured network policy."
        cat "$tmpdir/offline-metadata.log" >&2
      fi
    fi
  fi
else
  export CARGO_HOME="$tmpdir/cargo-home"
  export CARGO_TARGET_DIR="$tmpdir/cargo-target"
fi
install_root="$tmpdir/runtime-install"
stage_phase=build_failed
env -u RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS "${build_environment[@]}" \
  PATH="$toolchain_root/bin:$PATH" CARGO_HOME="$CARGO_HOME" \
  "$toolchain_cargo" install --locked --root "$install_root" \
  --target "$rust_target" --version "=$version" redevplugin-runtime 2> >(tee "$tmpdir/build.log" >&2) || {
    if LC_ALL=C grep -Eq '^error: (failed to download|download of .* failed|failed to get .* as a dependency)' "$tmpdir/build.log"; then
      echo "[redevplugin-stage:download_failed] Failed to acquire the locked Runtime sources" >&2
    else
      echo "[redevplugin-stage:build_failed] Published Runtime source compilation failed" >&2
    fi
    exit 1
  }
stage_phase=validation_failed

runtime_sources=()
while IFS= read -r runtime_source; do
  runtime_sources+=("$runtime_source")
done < <(find "$CARGO_HOME/registry/src" \
  -mindepth 2 -maxdepth 2 -type d -name "redevplugin-runtime-$version" -print)
[[ "${#runtime_sources[@]}" -eq 1 ]] || die "Cargo cache does not contain one exact published runtime source"
runtime_source="${runtime_sources[0]}"
[[ ! -L "$runtime_source" && -f "$runtime_source/Cargo.toml" && -f "$runtime_source/Cargo.lock" ]] ||
  die "published runtime source is missing its locked Cargo manifest"
runtime_registry=$(basename -- "$(dirname -- "$runtime_source")")
crate_archive="$CARGO_HOME/registry/cache/$runtime_registry/redevplugin-runtime-$version.crate"
[[ -f "$crate_archive" && ! -L "$crate_archive" ]] ||
  die "Cargo cache does not contain the exact published runtime crate"
actual_runtime_crate_sha=$(REDEVEN_PLUGIN_CRATE="$crate_archive" node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const hash = createHash('sha256').update(readFileSync(process.env.REDEVEN_PLUGIN_CRATE)).digest('hex');
process.stdout.write(hash);
NODE
)
[[ "$actual_runtime_crate_sha" == "$expected_runtime_crate_sha" ]] ||
  die "redevplugin-runtime crate digest does not match the published release manifest"
PATH="$toolchain_root/bin:$PATH" CARGO_HOME="$CARGO_HOME" "$toolchain_cargo" metadata \
  --format-version 1 \
  --locked \
  --filter-platform "$rust_target" \
  --manifest-path "$runtime_source/Cargo.toml" >"$tmpdir/cargo-metadata.raw.json"
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" project-runtime-cargo-metadata \
  "$tmpdir/cargo-metadata.raw.json" "$tmpdir/cargo-metadata.json"

runtime="$tmpdir/redevplugin-runtime"
install -m 0755 "$install_root/bin/redevplugin-runtime" "$runtime"
if [[ "$goos" == "darwin" ]]; then
  if [[ "$profile" == "release" ]]; then
    codesign_identity="${REDEVEN_REDEVPLUGIN_RUNTIME_CODESIGN_IDENTITY:-}"
    [[ -n "$codesign_identity" ]] || die "release Darwin runtime build requires REDEVEN_REDEVPLUGIN_RUNTIME_CODESIGN_IDENTITY"
    codesign --force --options runtime --entitlements "$SCRIPT_DIR/redevplugin-runtime-entitlements.plist" --timestamp --sign "$codesign_identity" "$runtime"
  else
    codesign --force --options runtime --entitlements "$SCRIPT_DIR/redevplugin-runtime-entitlements.plist" --sign - "$runtime"
  fi
  python3 "$SCRIPT_DIR/verify_redevplugin_macos_signature.py" "$runtime"
fi
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-runtime-executable "$runtime" "$target"

provenance="$tmpdir/$RUNTIME_PROVENANCE"
sbom="$tmpdir/$RUNTIME_SBOM"
notices="$tmpdir/$RUNTIME_NOTICES"
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" write-build-evidence \
  --release-verification "$release_verification" \
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
  cosign sign-blob --yes --new-bundle-format=false --use-signing-config=false \
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
  --release-verification "$release_verification" \
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
install -m 0644 "$manifest" "$staged/$RELEASE_MANIFEST_ASSET"
install -m 0644 "$release_verification" "$staged/$RELEASE_VERIFICATION"
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
