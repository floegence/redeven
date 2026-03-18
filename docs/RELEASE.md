# Release Process

This document defines the release process for `redeven-agent`.

## Goals

- Deterministic versioned artifacts (`vX.Y.Z`)
- Verifiable supply chain (`SHA256SUMS` + signature)
- Keyless signing (GitHub OIDC + Cosign)
- Public release contract that stays auditable from this repository alone

## Release trigger

The binary release workflow is `.github/workflows/release.yml`.

It runs automatically when a tag that matches `v*` is pushed.

## GitHub Release notes quality baseline

Each GitHub Release must include both:

1. A curated operator-facing preface (install/upgrade commands, asset list, verification snippet).
2. The GitHub auto-generated change list (PR and commit summary).

Implementation in this repository:

- Notes preface generator: `scripts/generate_release_notes.sh`
- Workflow integration: `.github/workflows/release.yml` (preface file + GitHub Release Notes API)

This keeps every release self-service for operators while preserving a complete change history for open source transparency.

## GitHub Release artifacts

For each release tag, the workflow publishes:

- `redeven_linux_amd64.tar.gz`
- `redeven_linux_arm64.tar.gz`
- `redeven_darwin_amd64.tar.gz`
- `redeven_darwin_arm64.tar.gz`
- `Redeven-Desktop-X.Y.Z-linux-x64.deb`
- `Redeven-Desktop-X.Y.Z-linux-x64.rpm`
- `Redeven-Desktop-X.Y.Z-linux-arm64.deb`
- `Redeven-Desktop-X.Y.Z-linux-arm64.rpm`
- `Redeven-Desktop-X.Y.Z-mac-x64.dmg`
- `Redeven-Desktop-X.Y.Z-mac-arm64.dmg`
- `SHA256SUMS`
- `SHA256SUMS.sig`
- `SHA256SUMS.pem`

All artifacts are uploaded to the GitHub Release for that tag.

Desktop assets bundle the matching `redeven` binary inside the Electron package and use the same release tag as the CLI tarballs.

## macOS desktop signing baseline

Public macOS desktop artifacts must satisfy all of the following before a tag is considered releasable:

- Sign the bundled Electron app with a `Developer ID Application` certificate.
- Notarize the signed app with Apple and staple the notarization ticket during packaging.
- Fail the release workflow if the required signing or notarization secrets are missing.

Repository secrets expected by `.github/workflows/release.yml`:

- `REDEVEN_DESKTOP_MAC_CERT_BASE64`
- `REDEVEN_DESKTOP_MAC_CERT_PASSWORD`
- `REDEVEN_DESKTOP_MAC_IDENTITY`
- `REDEVEN_DESKTOP_MAC_NOTARY_API_KEY`
- `REDEVEN_DESKTOP_MAC_NOTARY_API_KEY_ID`
- `REDEVEN_DESKTOP_MAC_NOTARY_API_ISSUER`

Notes:

- `REDEVEN_DESKTOP_MAC_CERT_BASE64` must contain the base64-encoded `.p12` Developer ID certificate bundle.
- `REDEVEN_DESKTOP_MAC_NOTARY_API_KEY` must contain the raw contents of the Apple App Store Connect API key (`.p8`).
- Ad-hoc signing (`REDEVEN_DESKTOP_MAC_IDENTITY=-`) remains acceptable for local packaging only and must not be used for public releases.

## Signature model

`SHA256SUMS` is signed with Cosign keyless mode.

Verification is bound to:

- OIDC issuer: `https://token.actions.githubusercontent.com`
- Workflow identity regex:
  `^https://github.com/floegence/redeven-agent/.github/workflows/release\.yml@refs/tags/v.*$`

This is the same identity constraint used by `install.sh`.

## Install script delivery

The installer script source of truth is in this repository:

- `scripts/install.sh`

`install.sh` download strategy:

- GitHub Release assets only
- Latest version resolved via GitHub Releases API unless `REDEVEN_VERSION` is explicitly provided
- Installer script can be fetched directly from this repository (for example via raw GitHub content)

## Local verification example

```bash
# Download from a release page first:
#   SHA256SUMS
#   SHA256SUMS.sig
#   SHA256SUMS.pem

cosign verify-blob \
  --certificate SHA256SUMS.pem \
  --signature SHA256SUMS.sig \
  --certificate-identity-regexp '^https://github.com/floegence/redeven-agent/.github/workflows/release\.yml@refs/tags/v.*$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS

sha256sum -c SHA256SUMS
```

## Operational notes

- Keep release tags immutable.
- If a release is bad, publish a new patch tag; do not overwrite existing assets.
- If the workflow identity changes (repo/path/workflow name), update the identity regex in:
  - `docs/RELEASE.md`
  - `scripts/install.sh`
- Keep downstream packaging or deployment logic outside this public repository.
