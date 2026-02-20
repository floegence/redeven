# Release Process

This document defines the release process for `redeven-agent`.

## Goals

- Deterministic versioned artifacts (`vX.Y.Z`)
- Verifiable supply chain (`SHA256SUMS` + signature)
- Keyless signing (GitHub OIDC + Cosign)
- external delivery package mirror parity with GitHub Release artifacts

## Release trigger

The binary release workflow is `.github/workflows/release.yml`.

It runs automatically when a tag that matches `v*` is pushed.

## GitHub Release notes quality baseline

Each GitHub Release must include both:

1. A curated operator-facing preface (install/upgrade commands, asset list, verification snippet, mirror context).
2. The GitHub auto-generated change list (PR and commit summary).

Implementation in this repository:

- Notes preface generator: `scripts/generate_release_notes.sh`
- Workflow integration: `.github/workflows/release.yml` (`body_path` + `generate_release_notes: true`)

This keeps every release self-service for operators while preserving a complete change history for open source transparency.

## GitHub Release artifacts

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

This is the same identity constraint used by `install.sh`.

## downstream automation dispatch (automatic)

The release workflow sends a `release hook` event after GitHub Release is published.

Event contract:

- Event type: `release_published`
- Payload fields:
  - `release_repo` (value: `${{ github.repository }}`)
  - `release_tag` (value: `${{ github.ref_name }}`)
  - `recommended_version` (default: same as `release_tag`)

Required repository secrets:

- `REDEVEN_RELEASE_HOOK_TOKEN`
- `REDEVEN_RELEASE_HOOK_TARGET` (format: `owner/repo`)

Failure policy:

- If dispatch fails, `.github/workflows/release.yml` fails at `Notify downstream automation`.
- GitHub Release tag and published assets stay immutable.

## external delivery package mirror + version endpoint (handled by downstream automation)

external delivery mirror sync and manifest deployment run in the downstream automation repository.

downstream automation workflow responsibilities:

1. Download release assets from GitHub Release.
2. Verify `SHA256SUMS` and Cosign signature.
3. Upload verified assets to package mirror path:
   - `release-assets/<tag>/...`
4. Re-download uploaded files and verify SHA256 parity.
5. Deploy the version-manifest Worker after package mirror verification succeeds.

Manifest endpoint served by Worker:

- URL: `https://version.agent.example.invalid/v1/manifest.json`
- Worker source of truth is in the downstream automation repository.

## Install script delivery

The installer script source of truth is in this repository:

- `scripts/install.sh`

`install.sh` download strategy:

- Primary: GitHub Release assets
- Fallback: external delivery package mirror (`agent.package.example.invalid`)

## Installer wrapper deployment (separate from package mirror)

external delivery Worker deployment for `example.invalid/install.sh` is managed by **downstream deployment automation** (GitHub integration), not by GitHub Actions.

Worker files:

- generator: `deployment/private-delivery/workers/install-agent/generate-worker.js`
- generated bundle: `deployment/private-delivery/workers/install-agent/dist/install-worker.mjs`
- wrangler config: `deployment/private-delivery/workers/install-agent/wrangler.toml`

### One-time external delivery setup (installer wrapper)

Configure the Worker build in external delivery Dashboard:

1. Connect repository: `<your-redeven-agent-repository>`.
2. Set production branch to `release`.
3. Set project root to `deployment/private-delivery/workers/install-agent`.
4. Build command: `node generate-worker.js`.
5. Deploy command: `npx wrangler deploy --config wrangler.toml`.

Also ensure `release` branch exists on origin (run once if needed):

```bash
git push origin origin/main:refs/heads/release
```

This setup ensures merges into `main` do not deploy the installer wrapper.

### Tag-driven installer wrapper rollout (when installer changed)

Use this only when installer/worker source changes need rollout:

```bash
./scripts/publish_delivery_branch.sh vX.Y.Z
```

This force-updates `release` to the tag commit and triggers downstream deployment automation.

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
