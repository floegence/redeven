#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "usage: $0 --dmg <file> --arch <x64|arm64> --expected-team-id <id> --sparkle-public-key <key>" >&2
  exit 64
}

dmg=""
arch=""
expected_team_id=""
sparkle_public_key=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg) dmg=${2:-}; shift 2 ;;
    --arch) arch=${2:-}; shift 2 ;;
    --expected-team-id) expected_team_id=${2:-}; shift 2 ;;
    --sparkle-public-key) sparkle_public_key=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

[[ -f "$dmg" && ! -L "$dmg" ]] || usage
[[ "$arch" == "x64" || "$arch" == "arm64" ]] || usage
[[ "$expected_team_id" =~ ^[A-Z0-9]{10}$ ]] || usage
[[ "$sparkle_public_key" =~ ^[A-Za-z0-9+/]{43}=$ ]] || usage

mount_point=$(mktemp -d "${TMPDIR:-/tmp}/redeven-desktop-dmg.XXXXXX")
mounted=0
cleanup() {
  if [[ $mounted -eq 1 ]]; then
    hdiutil detach "$mount_point" -quiet || true
  fi
  rm -rf "$mount_point"
}
trap cleanup EXIT

hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount_point" -quiet
mounted=1
shopt -s nullglob
apps=("$mount_point"/*.app)
[[ ${#apps[@]} -eq 1 ]] || {
  echo "Desktop DMG must contain exactly one application." >&2
  exit 1
}

app_bundle=${apps[0]}
info_plist="$app_bundle/Contents/Info.plist"
framework="$app_bundle/Contents/Frameworks/Sparkle.framework"
addon="$app_bundle/Contents/Resources/native/redeven_sparkle.node"
[[ -f "$info_plist" && -d "$framework" && -f "$addon" && ! -L "$addon" ]] || {
  echo "Desktop package is missing Sparkle update components." >&2
  exit 1
}

expected_machine=$arch
if [[ "$arch" == "x64" ]]; then expected_machine=x86_64; fi
file "$addon" | rg -q "${expected_machine}"
lipo -verify_arch "$expected_machine" "$framework/Versions/Current/Sparkle"
otool -L "$addon" | rg -q '@rpath/Sparkle\.framework/Versions/B/Sparkle'
otool -l "$addon" | rg -q '@loader_path/\.\./\.\./Frameworks'

plist_value() {
  plutil -extract "$1" raw -o - "$info_plist"
}

[[ "$(plist_value SUPublicEDKey)" == "$sparkle_public_key" ]]
[[ "$(plist_value SURequireSignedFeed)" == "true" ]]
[[ "$(plist_value SUVerifyUpdateBeforeExtraction)" == "true" ]]
[[ "$(plist_value SUEnableSystemProfiling)" == "false" ]]
[[ "$(plist_value SUEnableAutomaticChecks)" == "true" ]]
[[ "$(plist_value SUScheduledCheckInterval)" == "86400" ]]
[[ "$(plist_value SUAutomaticallyUpdate)" == "false" ]]
[[ "$(plist_value SUAllowsAutomaticUpdates)" == "false" ]]
feed_url=$(plist_value SUFeedURL)
[[ "$feed_url" == https://*"/appcast-mac-${arch}.xml" && "$feed_url" != *"@"* ]]

codesign --verify --deep --strict --verbose=2 "$app_bundle"
for signed_path in "$app_bundle" "$framework" "$addon"; do
  signature_info=$(codesign -dv --verbose=4 "$signed_path" 2>&1)
  team_id=$(sed -n 's/^TeamIdentifier=//p' <<<"$signature_info" | head -n 1)
  [[ "$team_id" == "$expected_team_id" ]] || {
    echo "Desktop package Team ID does not match the protected release configuration." >&2
    exit 1
  }
done
app_signature_info=$(codesign -dv --verbose=4 "$app_bundle" 2>&1)
rg -q 'flags=.*runtime' <<<"$app_signature_info"

xcrun stapler validate "$app_bundle"
xcrun stapler validate "$dmg"
spctl --assess --type execute --verbose=2 "$app_bundle"
spctl --assess --type install --verbose=2 "$dmg"

echo "Verified signed, notarized, stapled Sparkle package for macOS ${arch}."
