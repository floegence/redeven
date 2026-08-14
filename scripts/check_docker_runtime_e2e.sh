#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
RUST_TOOLCHAIN="1.88.0"
RUST_IMAGE="rust:${RUST_TOOLCHAIN}-bookworm"

module_copy_root=$(mktemp -d "${TMPDIR:-/tmp}/redeven-docker-runtime-mod.XXXXXX")
build_root=""
cleanup() {
  rm -rf "$module_copy_root"
  if [ -n "$build_root" ]; then
    rm -rf "$build_root"
  fi
}
trap cleanup EXIT
cp "$ROOT_DIR/go.mod" "$module_copy_root/go.mod"
cp "$ROOT_DIR/go.sum" "$module_copy_root/go.sum"
docker_e2e_go_flags="${GOFLAGS:-}"
if [ -n "$docker_e2e_go_flags" ]; then
  docker_e2e_go_flags+=" "
fi
export GOFLAGS="${docker_e2e_go_flags}-modfile=$module_copy_root/go.mod"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker runtime e2e failed: docker is not installed or not on PATH" >&2
  exit 1
fi

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "docker runtime e2e failed: docker daemon is not available" >&2
  exit 1
fi

docker_arch=$(docker info --format '{{.Architecture}}')
case "$docker_arch" in
  amd64|x86_64)
    goarch="amd64"
    rust_target="x86_64-unknown-linux-gnu"
    ;;
  arm64|aarch64)
    goarch="arm64"
    rust_target="aarch64-unknown-linux-gnu"
    ;;
  *)
    echo "docker runtime e2e failed: unsupported Docker architecture $docker_arch" >&2
    exit 1
    ;;
esac

redevplugin_version=$(
  cd "$ROOT_DIR"
  GOWORK=off go run ./scripts/read_redevplugin_package_set.go |
    node -e 'let input = ""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(input).platform_version));'
)
if [[ ! "$redevplugin_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "docker runtime e2e failed: invalid ReDevPlugin version $redevplugin_version" >&2
  exit 1
fi

cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/redeven/docker-runtime-e2e"
product_commit=$(git -C "$ROOT_DIR" rev-parse HEAD)
product_branch=$(git -C "$ROOT_DIR" branch --show-current)
if [ -z "$product_branch" ]; then
  product_branch="detached/$product_commit"
fi
runtime_cache="$cache_root/redevplugin-runtime-${redevplugin_version}-rust-${RUST_TOOLCHAIN}-linux-${goarch}-${product_commit}-evidence-v1"
runtime_path="$runtime_cache/redevplugin-runtime"
runtime_descriptor="$runtime_cache/.redevplugin-release-artifacts-verified.json"
mkdir -p "$runtime_cache" "$cache_root/cargo-home" "$cache_root/cargo-target-${goarch}"

if ! node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-runtime-directory \
  --root "$runtime_cache" --target "linux/$goarch" --require-release false >/dev/null 2>&1
then
	build_root=$(mktemp -d "${TMPDIR:-/tmp}/redeven-docker-runtime.XXXXXX")
	runtime_evidence="$build_root/runtime-evidence"
	mkdir -p "$runtime_evidence" "$build_root/upstream"
	package_set="$build_root/platform-package-set-v3.json"
	(
		cd "$ROOT_DIR"
		GOWORK=off go run ./scripts/read_redevplugin_package_set.go >"$package_set"
	)
	gh release download "v$redevplugin_version" \
		--repo floegence/redevplugin \
		--dir "$build_root/upstream" \
		--pattern platform-package-publication-v2.json
	publication_verification="$build_root/platform-publication-verification-v1.json"
	"$SCRIPT_DIR/check_redevplugin_release_artifacts.sh" \
		--artifact-dir "$build_root/upstream" \
		--tag "v$redevplugin_version" \
		--write-marker "$publication_verification"

	rustflags_key="CARGO_TARGET_$(printf '%s' "$rust_target" | tr '[:lower:]-' '[:upper:]_')_RUSTFLAGS"
	docker run --rm \
		--user "$(id -u):$(id -g)" \
		--env CARGO_HOME=/cargo-home \
		--env CARGO_TARGET_DIR=/cargo-target \
		--env "REDEVPLUGIN_VERSION=$redevplugin_version" \
		--env "REDEVPLUGIN_RUST_TARGET=$rust_target" \
		--env "$rustflags_key=-C target-feature=+crt-static -C relocation-model=pic -C linker=/redevplugin-static-pie-linker" \
		--volume "$cache_root/cargo-home:/cargo-home" \
		--volume "$cache_root/cargo-target-${goarch}:/cargo-target" \
		--volume "$build_root:/output" \
		--volume "$SCRIPT_DIR/link_redevplugin_runtime_static_pie.sh:/redevplugin-static-pie-linker:ro" \
		"$RUST_IMAGE" \
		bash -ceu '
			cargo install --locked --root /output --target "$REDEVPLUGIN_RUST_TARGET" \
				--version "=$REDEVPLUGIN_VERSION" redevplugin-runtime
			mapfile -t runtime_sources < <(find /cargo-home/registry/src -mindepth 2 -maxdepth 2 \
				-type d -name "redevplugin-runtime-$REDEVPLUGIN_VERSION" -print)
			if [ "${#runtime_sources[@]}" -ne 1 ]; then
				echo "docker runtime e2e failed: expected one exact published runtime source" >&2
				exit 1
			fi
			cargo metadata --format-version 1 --locked --filter-platform "$REDEVPLUGIN_RUST_TARGET" \
				--manifest-path "${runtime_sources[0]}/Cargo.toml" > /output/cargo-metadata.raw.json
			cargo --version > /output/cargo-version.txt
			rustc --version > /output/rustc-version.txt
		'
	node "$SCRIPT_DIR/redevplugin_release_contract.mjs" project-runtime-cargo-metadata \
		"$build_root/cargo-metadata.raw.json" "$build_root/cargo-metadata.json"
	install -m 0755 "$build_root/bin/redevplugin-runtime" "$runtime_evidence/redevplugin-runtime"
	node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-elf \
		"$runtime_evidence/redevplugin-runtime" "linux/$goarch"

	node "$SCRIPT_DIR/redevplugin_release_contract.mjs" write-build-evidence \
		--package-set "$package_set" \
		--publication-verification "$publication_verification" \
		--cargo-metadata "$build_root/cargo-metadata.json" \
		--product-repository floegence/redeven \
		--product-workflow .github/workflows/release.yml \
		--product-ref "refs/heads/$product_branch" \
		--product-commit "$product_commit" \
		--target "linux/$goarch" \
		--runtime "$runtime_evidence/redevplugin-runtime" \
		--provenance-out "$runtime_evidence/redevplugin-runtime.provenance.json" \
		--sbom-out "$runtime_evidence/REDEVPLUGIN_RUNTIME.spdx.json" \
		--notices-out "$runtime_evidence/REDEVPLUGIN_THIRD_PARTY_NOTICES.md"

	RUNTIME="$runtime_evidence/redevplugin-runtime" \
	SIGNATURE="$runtime_evidence/redevplugin-runtime.sig" \
	CERTIFICATE="$runtime_evidence/redevplugin-runtime.pem" \
		node --input-type=module <<'NODE'
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const keys = generateKeyPairSync('ed25519');
writeFileSync(process.env.SIGNATURE, sign(null, readFileSync(process.env.RUNTIME), keys.privateKey), { flag: 'wx', mode: 0o644 });
writeFileSync(process.env.CERTIFICATE, keys.publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx', mode: 0o644 });
NODE

	node "$SCRIPT_DIR/redevplugin_release_contract.mjs" write-runtime-marker \
		--profile development \
		--package-set "$package_set" \
		--publication-verification "$publication_verification" \
		--product-repository floegence/redeven \
		--product-workflow .github/workflows/release.yml \
		--product-ref "refs/heads/$product_branch" \
		--product-commit "$product_commit" \
		--target "linux/$goarch" \
		--runtime "$runtime_evidence/redevplugin-runtime" \
		--sbom "$runtime_evidence/REDEVPLUGIN_RUNTIME.spdx.json" \
		--provenance "$runtime_evidence/redevplugin-runtime.provenance.json" \
		--notices "$runtime_evidence/REDEVPLUGIN_THIRD_PARTY_NOTICES.md" \
		--signature "$runtime_evidence/redevplugin-runtime.sig" \
		--certificate "$runtime_evidence/redevplugin-runtime.pem" \
		--cargo-version "$(tr -d '\r\n' <"$build_root/cargo-version.txt")" \
		--rustc-version "$(tr -d '\r\n' <"$build_root/rustc-version.txt")" \
		--out "$runtime_evidence/.redevplugin-release-artifacts-verified.json"
	node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-runtime-directory \
		--root "$runtime_evidence" --target "linux/$goarch" --require-release false

	if [ -z "$(find "$runtime_cache" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
		rmdir "$runtime_cache"
		mv "$runtime_evidence" "$runtime_cache"
		runtime_path="$runtime_cache/redevplugin-runtime"
		runtime_descriptor="$runtime_cache/.redevplugin-release-artifacts-verified.json"
	else
		runtime_path="$runtime_evidence/redevplugin-runtime"
		runtime_descriptor="$runtime_evidence/.redevplugin-release-artifacts-verified.json"
	fi
fi

if [ ! -d "$ROOT_DIR/internal/envapp/ui/dist" ] || [ ! -d "$ROOT_DIR/internal/codeapp/ui/dist" ]; then
  "$ROOT_DIR/scripts/build_assets.sh"
fi

(
	cd "$ROOT_DIR"
	REDEVEN_DOCKER_E2E_REDEVPLUGIN_RUNTIME="$runtime_path" \
		REDEVEN_DOCKER_E2E_REDEVPLUGIN_DESCRIPTOR="$runtime_descriptor" \
		GOWORK=off go test -tags docker_e2e -count=1 ./tests/docker_runtime_e2e
)
