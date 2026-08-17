#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
REPOSITORY="floegence/redevplugin"
ASSET_NAME="platform-release-manifest.json"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_redevplugin_release_artifacts.sh --artifact-dir <dir> --tag <vX.Y.Z>
  ./scripts/check_redevplugin_release_artifacts.sh --self-test

Verifies the exact staging-only ReDevPlugin platform release manifest and
readbacks of the published Go module, npm packages, and Rust source crates.
USAGE
}

artifact_dir=""
tag=""
self_test=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-dir) artifact_dir="${2:-}"; shift 2 ;;
    --tag) tag="${2:-}"; shift 2 ;;
    --self-test) self_test=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unexpected argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "[redevplugin-release] $*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

if [[ "$self_test" -eq 1 ]]; then
  [[ -z "$artifact_dir$tag" ]] || die "--self-test cannot be combined with release arguments"
  exec node --test "$SCRIPT_DIR/redevplugin_release_contract.test.mjs"
fi

[[ -n "$artifact_dir" && -d "$artifact_dir" && -n "$tag" ]] || { usage >&2; exit 2; }
for command in curl gh go jq node npm sha256sum; do require_command "$command"; done
artifact_dir=$(cd -- "$artifact_dir" >/dev/null 2>&1 && pwd -P)
manifest="$artifact_dir/$ASSET_NAME"
[[ -f "$manifest" && ! -L "$manifest" ]] || die "release is missing $ASSET_NAME"

entries=$(find "$artifact_dir" -mindepth 1 -maxdepth 1 -type f -print | wc -l | tr -d ' ')
[[ "$entries" == 1 ]] || die "release artifact directory must contain only $ASSET_NAME"
node "$SCRIPT_DIR/redevplugin_release_contract.mjs" verify-release-manifest "$manifest" "$tag" >/dev/null

release_json=$(gh release view "$tag" --repo "$REPOSITORY" --json isDraft,isPrerelease,tagName,assets)
RELEASE_JSON="$release_json" EXPECTED_TAG="$tag" node --input-type=module <<'NODE'
const value = JSON.parse(process.env.RELEASE_JSON);
if (value.isDraft || value.isPrerelease || value.tagName !== process.env.EXPECTED_TAG) throw new Error('release state is invalid');
if (!Array.isArray(value.assets) || value.assets.length !== 1 || value.assets[0].name !== 'platform-release-manifest.json') {
  throw new Error('release asset inventory is invalid');
}
NODE

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

manifest_digest() { jq -er --arg name "$1" '.artifacts[] | select(.name == $name) | .sha256' "$manifest"; }
check_digest() {
  local name="$1" file="$2" expected
  expected=$(manifest_digest "$name")
  [[ "$(sha256sum "$file" | awk '{print $1}')" == "$expected" ]] || die "digest mismatch for $name"
}

go_json="$tmpdir/go.json"
GOWORK=off GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org \
  go mod download -json "github.com/floegence/redevplugin/v3@$tag" >"$go_json"
check_digest "go:github.com/floegence/redevplugin/v3" "$(jq -er .Zip "$go_json")"

while IFS=$'\t' read -r name version; do
  url=$(npm view "$name@$version" dist.tarball --json | jq -er '.')
  file="$tmpdir/$(printf '%s' "$name" | tr '/@' '__').tgz"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$url" --output "$file"
  check_digest "npm:$name" "$file"
done < <(jq -r --arg version "${tag#v}" '.artifacts[] | select(.name | startswith("npm:")) | [.name[4:], $version] | @tsv' "$manifest")

while IFS=$'\t' read -r name version; do
  file="$tmpdir/$name-$version.crate"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "https://static.crates.io/crates/$name/$name-$version.crate" --output "$file"
  check_digest "crate:$name" "$file"
done < <(jq -r --arg version "${tag#v}" '.artifacts[] | select(.name | startswith("crate:")) | [.name[6:], $version] | @tsv' "$manifest")

echo "[INFO] ReDevPlugin $tag release manifest and registry artifacts verified"
