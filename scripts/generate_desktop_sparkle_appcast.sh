#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "usage: $0 --dmg <file> --arch <x64|arm64> --tag <vX.Y.Z> --output-dir <dir> [--sparkle-bin-dir <dir>]" >&2
  exit 64
}

dmg=""
arch=""
tag=""
output_dir=""
sparkle_bin_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg) dmg=${2:-}; shift 2 ;;
    --arch) arch=${2:-}; shift 2 ;;
    --tag) tag=${2:-}; shift 2 ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    --sparkle-bin-dir) sparkle_bin_dir=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

[[ -f "$dmg" && ! -L "$dmg" ]] || usage
[[ "$arch" == "x64" || "$arch" == "arm64" ]] || usage
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Sparkle appcasts are generated only for stable release tags." >&2
  exit 64
}
[[ -n "$output_dir" ]] || usage

private_key=${REDEVEN_SPARKLE_PRIVATE_KEY:-}
public_key=${REDEVEN_SPARKLE_PUBLIC_ED_KEY:-}
repository=${GITHUB_REPOSITORY:-}
[[ "$private_key" =~ ^[A-Za-z0-9+/]{43}=$ ]] || {
  echo "REDEVEN_SPARKLE_PRIVATE_KEY must be a base64-encoded 32-byte Ed25519 seed." >&2
  exit 1
}
[[ "$public_key" =~ ^[A-Za-z0-9+/]{43}=$ ]] || {
  echo "REDEVEN_SPARKLE_PUBLIC_ED_KEY must be a base64-encoded 32-byte Ed25519 key." >&2
  exit 1
}
[[ "$repository" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]] || {
  echo "GITHUB_REPOSITORY must be owner/repository for Sparkle publication." >&2
  exit 1
}

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -z "$sparkle_bin_dir" ]]; then
  sparkle_bin_dir="$repo_root/desktop/native/macos-updater/.build/artifacts/sparkle/Sparkle/bin"
fi
generate_appcast="$sparkle_bin_dir/generate_appcast"
sign_update="$sparkle_bin_dir/sign_update"
[[ -x "$generate_appcast" && -x "$sign_update" ]] || {
  echo "Sparkle release tools are missing from $sparkle_bin_dir." >&2
  exit 1
}

version=${tag#v}
release_download_url="https://github.com/${repository}/releases/download/${tag}"
release_tag_url="https://github.com/${repository}/releases/tag/${tag}"
workspace=$(mktemp -d "${TMPDIR:-/tmp}/redeven-sparkle-appcast.XXXXXX")
key_file="$workspace/sparkle-private-key"
source_dir="$workspace/source"
cleanup() {
  rm -rf "$workspace"
}
trap cleanup EXIT

mkdir -p "$source_dir" "$output_dir"
printf '%s' "$private_key" > "$key_file"
chmod 600 "$key_file"
REDEVEN_SPARKLE_PUBLIC_ED_KEY="$public_key" node "$repo_root/scripts/verify_sparkle_keypair.mjs" "$key_file" >/dev/null

dmg_name="Redeven-Desktop-${version}-mac-${arch}.dmg"
notes_name="Redeven-Desktop-${version}-mac-${arch}.md"
cp "$dmg" "$source_dir/$dmg_name"
GITHUB_REPOSITORY="$repository" "$repo_root/scripts/generate_release_notes.sh" "$tag" "$source_dir/$notes_name"

appcast_path="$source_dir/appcast-mac-${arch}.xml"
printf '%s' "$private_key" | "$generate_appcast" \
  --ed-key-file - \
  --download-url-prefix "${release_download_url}/" \
  --release-notes-url-prefix "${release_download_url}/" \
  --full-release-notes-url "$release_tag_url" \
  --maximum-deltas 0 \
  -o "$appcast_path" \
  "$source_dir"

printf '%s' "$private_key" | "$sign_update" --ed-key-file - --verify "$appcast_path"
notes_signature=$(xmllint --xpath \
  'string((//*[local-name()="item"]/*[local-name()="releaseNotesLink"]/@*[local-name()="edSignature"])[1])' \
  "$appcast_path")
[[ -n "$notes_signature" ]] || {
  echo "Sparkle appcast is missing a release-notes signature." >&2
  exit 1
}
printf '%s' "$private_key" | "$sign_update" --ed-key-file - --verify "$source_dir/$notes_name" "$notes_signature"

enclosure_url=$(xmllint --xpath \
  'string((//*[local-name()="item"]/*[local-name()="enclosure"]/@url)[1])' \
  "$appcast_path")
enclosure_signature=$(xmllint --xpath \
  'string((//*[local-name()="item"]/*[local-name()="enclosure"]/@*[local-name()="edSignature"])[1])' \
  "$appcast_path")
expected_enclosure_url="${release_download_url}/${dmg_name}"
[[ "$enclosure_url" == "$expected_enclosure_url" && -n "$enclosure_signature" ]] || {
  echo "Sparkle appcast does not match the signed Desktop DMG." >&2
  exit 1
}

cp "$appcast_path" "$output_dir/appcast-mac-${arch}.xml"
cp "$source_dir/$notes_name" "$output_dir/$notes_name"
echo "Generated signed Sparkle appcast for macOS ${arch}."
