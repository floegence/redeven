#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
REPOSITORY="floegence/redevplugin"
ASSET_NAME="platform-package-publication-v1.json"
ASSET_CONTENT_TYPE="application/vnd.floegence.redevplugin-platform-publication.v1+json"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_redevplugin_release_artifacts.sh --artifact-dir <dir> --tag <vX.Y.Z> [--write-marker <file>]
  ./scripts/check_redevplugin_release_artifacts.sh --self-test

Verifies the exact ReDevPlugin platform publication consumed by Redeven. The
release must contain only the attested completion manifest, and every Go, npm,
and Rust registry readback must match the package-set contract embedded in the
released Go module.
USAGE
}

artifact_dir=""
tag=""
marker_path=""
self_test=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-dir) artifact_dir="${2:-}"; shift 2 ;;
    --tag) tag="${2:-}"; shift 2 ;;
    --write-marker) marker_path="${2:-}"; shift 2 ;;
    --self-test) self_test=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unexpected argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() {
  echo "[redevplugin-publication] $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

if [[ "$self_test" -eq 1 ]]; then
  [[ -z "$artifact_dir$tag$marker_path" ]] || die "--self-test cannot be combined with release arguments"
  exec node --test "$SCRIPT_DIR/redevplugin_release_contract.test.mjs"
fi

[[ -n "$artifact_dir" && -d "$artifact_dir" && -n "$tag" ]] || { usage >&2; exit 2; }
for command in curl gh go jq node npm python3; do require_command "$command"; done

artifact_dir=$(cd -- "$artifact_dir" >/dev/null 2>&1 && pwd -P)
publication_path="$artifact_dir/$ASSET_NAME"
[[ -f "$publication_path" && ! -L "$publication_path" ]] || die "release is missing the completion manifest"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
package_set_path="$tmpdir/package-set.json"
(cd "$ROOT_DIR" && GOWORK=off go run ./scripts/read_redevplugin_package_set.go >"$package_set_path")
version=$(jq -er '.platform_version' "$package_set_path")
[[ "$tag" == "v$version" ]] || die "release tag $tag does not match consumed package set v$version"

ARTIFACT_DIR="$artifact_dir" MARKER_PATH="$marker_path" ASSET_NAME="$ASSET_NAME" node <<'NODE'
const { lstatSync, readdirSync } = require('node:fs');
const { basename, dirname, join, resolve } = require('node:path');
const root = resolve(process.env.ARTIFACT_DIR);
const ignored = process.env.MARKER_PATH && resolve(dirname(process.env.MARKER_PATH)) === root
  ? basename(process.env.MARKER_PATH)
  : '';
const entries = readdirSync(root).filter((name) => name !== ignored);
if (entries.length !== 1 || entries[0] !== process.env.ASSET_NAME) {
  throw new Error(`GitHub Release directory must contain exactly ${process.env.ASSET_NAME}`);
}
const info = lstatSync(join(root, entries[0]));
if (info.isSymbolicLink() || !info.isFile()) throw new Error('release asset must be a regular file');
NODE

source_commit=$(node "$SCRIPT_DIR/redevplugin_release_contract.mjs" \
  verify-publication "$publication_path" "$package_set_path" "$tag")

ref_json=$(gh api "repos/$REPOSITORY/git/ref/tags/$tag")
object_type=$(jq -er '.object.type' <<<"$ref_json")
object_sha=$(jq -er '.object.sha' <<<"$ref_json")
if [[ "$object_type" == "tag" ]]; then
  tag_json=$(gh api "repos/$REPOSITORY/git/tags/$object_sha")
  object_type=$(jq -er '.object.type' <<<"$tag_json")
  object_sha=$(jq -er '.object.sha' <<<"$tag_json")
fi
[[ "$object_type" == "commit" && "$object_sha" == "$source_commit" ]] || die "release tag source identity mismatch"

release_json=$(gh release view "$tag" --repo "$REPOSITORY" --json isDraft,isPrerelease,tagName,assets)
RELEASE_JSON="$release_json" EXPECTED_TAG="$tag" EXPECTED_NAME="$ASSET_NAME" EXPECTED_TYPE="$ASSET_CONTENT_TYPE" node <<'NODE'
const value = JSON.parse(process.env.RELEASE_JSON);
if (value.isDraft || value.isPrerelease || value.tagName !== process.env.EXPECTED_TAG) {
  throw new Error('release state is invalid');
}
if (!Array.isArray(value.assets) || value.assets.length !== 1 || value.assets[0].name !== process.env.EXPECTED_NAME
    || value.assets[0].contentType !== process.env.EXPECTED_TYPE) {
  throw new Error('release asset inventory or media type is invalid');
}
NODE
gh attestation verify "$publication_path" --repo "$REPOSITORY" >/dev/null

go_readback="$tmpdir/go-readback.json"
GOWORK=off GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org \
  go mod download -json "github.com/floegence/redevplugin@$tag" >"$go_readback"
PUBLICATION="$publication_path" READBACK="$go_readback" node <<'NODE'
const { readFileSync } = require('node:fs');
const publication = JSON.parse(readFileSync(process.env.PUBLICATION, 'utf8'));
const readback = JSON.parse(readFileSync(process.env.READBACK, 'utf8'));
const expected = publication.go_module;
if (readback.Path !== expected.module || readback.Version !== expected.version
    || readback.Sum !== expected.h1 || readback.GoModSum !== expected.go_mod_h1) {
  throw new Error('Go proxy or SumDB readback mismatch');
}
NODE

while IFS=$'\t' read -r name package_version expected_integrity expected_sha512; do
  remote_integrity=$(npm view "$name@$package_version" dist.integrity --json | jq -er '.')
  [[ "$remote_integrity" == "$expected_integrity" ]] || die "npm integrity mismatch for $name@$package_version"
  tarball_url=$(npm view "$name@$package_version" dist.tarball --json | jq -er '.')
  package_path="$tmpdir/$(printf '%s' "$name" | tr '/@' '__').tgz"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --user-agent 'Redeven-ReDevPlugin-verifier/1' "$tarball_url" --output "$package_path"
  actual_sha512=$(node --input-type=module - "$package_path" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
process.stdout.write(createHash('sha512').update(readFileSync(process.argv[2])).digest('hex'));
NODE
  )
  [[ "$actual_sha512" == "$expected_sha512" ]] || die "npm provenance subject mismatch for $name@$package_version"
done < <(jq -r '.npm_packages[] | [.name,.version,.integrity,.provenance_subject_sha512] | @tsv' "$publication_path")

while IFS=$'\t' read -r name crate_version expected_checksum; do
  crate_path="$tmpdir/$name-$crate_version.crate"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --user-agent 'Redeven-ReDevPlugin-verifier/1' \
    "https://static.crates.io/crates/$name/$name-$crate_version.crate" --output "$crate_path"
  actual_checksum=$(node --input-type=module - "$crate_path" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
process.stdout.write(createHash('sha256').update(readFileSync(process.argv[2])).digest('hex'));
NODE
  )
  [[ "$actual_checksum" == "$expected_checksum" ]] || die "crates.io checksum mismatch for $name@$crate_version"
  python3 - "$crate_path" "$name" "$crate_version" "$source_commit" <<'PY'
import json
import sys
import tarfile

archive_path, name, version, source_commit = sys.argv[1:]
member = f"{name}-{version}/.cargo_vcs_info.json"
with tarfile.open(archive_path, mode="r:gz") as archive:
    names = archive.getnames()
    if names.count(member) != 1:
        raise SystemExit(f"{name}@{version} Cargo VCS identity is missing")
    raw = archive.extractfile(member).read()
value = json.loads(raw, object_pairs_hook=lambda pairs: dict(pairs) if len(dict(pairs)) == len(pairs) else (_ for _ in ()).throw(ValueError("duplicate field")))
if set(value) != {"git", "path_in_vcs"} or set(value["git"]) != {"sha1"}:
    raise SystemExit(f"{name}@{version} Cargo VCS identity fields are invalid")
if value["git"]["sha1"] != source_commit or value["path_in_vcs"] != f"crates/{name}":
    raise SystemExit(f"{name}@{version} Cargo VCS identity mismatch")
PY
done < <(jq -r '.rust_crates[] | [.name,.version,.registry_checksum_sha256] | @tsv' "$publication_path")

if [[ -n "$marker_path" ]]; then
  marker_parent=$(dirname -- "$marker_path")
  mkdir -p "$marker_parent"
  [[ ! -e "$marker_path" && ! -L "$marker_path" ]] || die "publication verification marker already exists"
  node "$SCRIPT_DIR/redevplugin_release_contract.mjs" \
    write-publication-verification "$publication_path" "$package_set_path" "$tag" "$marker_path"
fi

echo "[INFO] ReDevPlugin $tag package publication verified"
