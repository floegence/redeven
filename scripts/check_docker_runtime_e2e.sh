#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
RUST_TOOLCHAIN="1.88.0"
RUST_IMAGE="rust:${RUST_TOOLCHAIN}-bookworm"

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
runtime_cache="$cache_root/redevplugin-runtime-${redevplugin_version}-rust-${RUST_TOOLCHAIN}-linux-${goarch}-static-pie-v1"
runtime_path="$runtime_cache/redevplugin-runtime"
mkdir -p "$runtime_cache" "$cache_root/cargo-home" "$cache_root/cargo-target-${goarch}"

if ! node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-elf "$runtime_path" "linux/$goarch" >/dev/null 2>&1; then
  build_root=$(mktemp -d "${TMPDIR:-/tmp}/redeven-docker-runtime.XXXXXX")
  trap 'rm -rf "$build_root"' EXIT
  rustflags_key="CARGO_TARGET_$(printf '%s' "$rust_target" | tr '[:lower:]-' '[:upper:]_')_RUSTFLAGS"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --env CARGO_HOME=/cargo-home \
    --env CARGO_TARGET_DIR=/cargo-target \
    --env "$rustflags_key=-C target-feature=+crt-static -C relocation-model=pic -C linker=/redevplugin-static-pie-linker" \
    --volume "$cache_root/cargo-home:/cargo-home" \
    --volume "$cache_root/cargo-target-${goarch}:/cargo-target" \
    --volume "$build_root:/output" \
    --volume "$SCRIPT_DIR/link_redevplugin_runtime_static_pie.sh:/redevplugin-static-pie-linker:ro" \
    "$RUST_IMAGE" \
    cargo install \
      --locked \
      --root /output \
      --target "$rust_target" \
      --version "=$redevplugin_version" \
      redevplugin-runtime
  install -m 0755 "$build_root/bin/redevplugin-runtime" "$runtime_path"
  node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-elf "$runtime_path" "linux/$goarch"
fi

if [ ! -d "$ROOT_DIR/internal/envapp/ui/dist" ] || [ ! -d "$ROOT_DIR/internal/codeapp/ui/dist" ]; then
  "$ROOT_DIR/scripts/build_assets.sh"
fi

(
  cd "$ROOT_DIR"
  REDEVEN_DOCKER_E2E_REDEVPLUGIN_RUNTIME="$runtime_path" \
    GOWORK=off go test -tags docker_e2e -count=1 ./tests/docker_runtime_e2e
)
