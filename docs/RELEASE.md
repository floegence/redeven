# Release Process

This document defines the release process for `redeven-agent`.

## Goals

- Deterministic versioned artifacts (`vX.Y.Z`)
- Verifiable supply chain (`SHA256SUMS` + signature)
- Keyless signing (GitHub OIDC + Cosign)

## Trigger

The release workflow is `.github/workflows/release.yml`.

It runs automatically when a tag that matches `v*` is pushed.

## Artifacts

For each release tag, the workflow publishes:

- `redeven_linux_amd64.tar.gz`
- `redeven_linux_arm64.tar.gz`
- `redeven_darwin_amd64.tar.gz`
- `redeven_darwin_arm64.tar.gz`
- `SHA256SUMS`
- `SHA256SUMS.sig`
- `SHA256SUMS.pem`

All artifacts are uploaded to the GitHub Release for that tag.

## Signature model

`SHA256SUMS` is signed with Cosign keyless mode.

Verification is bound to:

- OIDC issuer: `https://token.actions.githubusercontent.com`
- Workflow identity regex:
  `^https://github.com/floegence/redeven-agent/.github/workflows/release\.yml@refs/tags/v.*$`

This is the same identity constraint used by `redeven` install/upgrade scripts.

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

## Install script deployment

The installer script source of truth is in this repository:

- `scripts/install.sh`

external delivery Worker deployment is handled by `.github/workflows/deploy-install-worker.yml`.

Trigger conditions:

- push to `main` with changes under `scripts/install.sh` or `deployment/private-delivery/workers/install-agent/**`
- published release
- manual dispatch

Worker files:

- generator: `deployment/private-delivery/workers/install-agent/generate-worker.js`
- generated bundle: `deployment/private-delivery/workers/install-agent/dist/install-worker.mjs`
- wrangler config: `deployment/private-delivery/workers/install-agent/wrangler.toml`

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Operational notes

- Keep release tags immutable.
- If a release is bad, publish a new patch tag; do not overwrite existing assets.
- If the workflow identity changes (repo/path/workflow name), update the identity regex in:
  - `docs/RELEASE.md`
  - `scripts/install.sh` (this repo)
