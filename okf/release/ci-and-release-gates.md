---
type: Release Contract
title: CI and release gates
description: Redeven binds published dependencies, generated assets, UI behavior, release payloads, tests, and OKF to the exact main tip being pushed.
tags: [release, ci, quality, okf]
timestamp: 2026-10-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven runs focused development checks, a fast staged pre-commit gate and one
bounded integration gate for the exact main tip being pushed. Published
dependencies, generated assets, localization, compatibility and OKF must agree.
Full browser, Desktop, Docker, performance and native qualification run explicitly;
release packaging additionally requires same-commit historical conversation
evidence and authenticated target-specific artifacts. Windows remains an internal
certification target and cannot enter the formal release inventory.

# Contract

## Validation and exact-tip ownership

[AGENTS.md](../../AGENTS.md) owns Git discipline and concise working rules; domain
contracts belong in OKF. `quick_ci_policy.test.mjs` enforces its 100-line limit,
index entrypoint and linked contracts.

| Level | Required scope |
| --- | --- |
| Development | Focused checks for changed behavior, source contracts and conflict resolution |
| Pre-commit | Staged diff, README localization, open-source hygiene and affected notices/viewer assets |
| Ordinary push/PR | One bounded source-only Actions job |
| Main pre-push | Clean, exact rebased base/tip; source, dependency, release, runtime and hygiene groups in `check_final_integration.sh` |
| Explicit qualification | Browser/UI, real Electron, Docker, native, stress and performance suites appropriate to the change |
| Release | Published artifact gates and successful historical conversation workflow evidence for the exact release commit |

Pre-push requires the checked-out local main tip to equal the pushed tip, verifies
fast-forward ancestry against the remote handshake and rejects unpublished merge
commits. Earlier or pre-rebase evidence cannot certify another tip. Local gate
fingerprints cover executables and inputs, excluding `MANPATH` because macOS hook
shells can change it without changing execution. Real-hook tests guard evidence
reuse. Generators must leave the tree unchanged; Go formatting reports all offending
tracked paths before expensive stages.

Staged notices use a temporary Git-index snapshot, including partial staging,
installed metadata and the exact cached staged Go toolchain with `GOTOOLCHAIN=local`.
Proxy, SumDB and VCS downloads are disabled. Missing prerequisites or stale output
stop commit; cleanup cannot rewrite the index or working files. Viewer assets verify
staged sources and locked installed dependencies without installation or generation.
Their sole generator is `internal/envapp/ui_src/scripts/buildHostApplicationAppearance.mjs`.

Daily/manual CodeQL is separate from push/PR. Unchanged main since the latest
successful scheduled analysis skips the language matrix; lookup failure scans.
Resolve findings against current source and every maintained lockfile. Dismissal
requires specific authorization/input-boundary evidence; unavailable scanning is
not clean. External Actions, including certificate import, use reviewed commit pins.
Their supported Node 24 runtime is independent of the product toolchain.

## Toolchains and generated assets

`go.mod` owns the exact Go patch; Actions use `go-version-file` and local gates
select the same version. `.node-version` owns first-party Node; helpers and package
engines reject other majors. Public README prerequisites and badges match these
sources. Desktop pnpm permits lifecycle scripts only for `electron` and `esbuild`,
ignoring `electron-winstaller` because internal Windows packaging uses NSIS.
Dependency changes regenerate and check `THIRD_PARTY_NOTICES.md`.

README translations preserve canonical structure, links, code literals, protected
terms and synchronization hashes in `assets/readme/locales.json`. Reviewer identity
or approval counts are not synchronization metadata. OKF matches active contracts;
its bundle, manifest and checksum are generated and committed together. Build embedded
UI assets before Go tests importing their embed packages.

Env App `pnpm build` owns a checkout-local `flock` across cleanup, TypeScript, Vite,
budget checks and compression. The inherited descriptor releases when build processes
exit. Same-checkout builds wait; worktrees remain independent. `build_assets.sh`
cannot compress after lock release or silently skip missing assets.

Shipped Runtime uses cgo plus `floeterm_native`, native Linux/Darwin amd64/arm64
runners and published terminal-go. Untagged live attachment fails closed. Source
contracts cover release, Desktop, SSH and carrier commands, including macOS Bash 3.2
strict-mode arguments. Main runs build contracts; full native execution is qualification.

## Qualification and security boundaries

`flower-history-qualification.yml` opens copied immutable released-writer databases,
explicitly continues through the product and repeats after restart. Release-ref
requires successful same-commit Actions evidence. Ordinary CI and main run source-only
fixture verification, not this full qualification. The [historical upgrade contract](../ai/flower-upgrade-compatibility.md)
owns preservation, failure and restore requirements.

Explicit UI/renderer gates use canonical headless browser/carrier runners and fresh
exact-source assets. Ignored prior `dist` output and headed diagnostics cannot establish
that evidence. [Upstream web dependencies](../architecture/env-app-upstream-web-dependencies.md)
own browser modes. Renderer-only Floe tests use client Vitest/browser resolution and
a DOM; mocks retain real utilities unless testing that boundary. Headless fixtures
retain scrollbars and explicit space-consuming geometry, and await focus restoration
after unmount paint. PDF drag fixtures remove only runner preview scaling and restore
it after interaction, preserving the product canvas projection.

[Desktop qualification lifecycle](../desktop/desktop-test-lifecycle.md) owns processes
and cleanup. Preload tests verify temporary working and separate utility/session
user-data paths inside Electron. Cleanup targets only the spawned POSIX group or
addressable Windows tree and waits for drain; external SIGKILL remains failure.
Preflight resolves and executes the exact pinned npm Electron binary inside Desktop
`node_modules`. Signal/AMFI rejection is an environment failure; tests never sign
Electron, change host trust or mutate dependencies to bypass it.

Manual Windows WSL certification requires exact `origin/main`, a matching Linux amd64
Runtime and two isolated WSL 2 distributions. It covers install, Start, private Bridge,
external shutdown, explicit Retry, Update and exact Stop before an unsigned internal
NSIS build. Only workflow cleanup may unregister its temporary distributions.

Security-sensitive inspection, hashing and consumption use one no-follow descriptor
for signed native manifests, Runtime log tails, source identity, installer pins,
Sparkle keys and qualification credentials. Source capture also matches the enumerated
inode; replacement tests guard these boundaries. Computer qualification proxies accept
only the fixed Responses POST route. Terminal carrier TLS exceptions require that
run's isolated device CA authentication. AI diagnostics are bounded single-line text.
Explicit report paths, synthetic credentials and POSIX-quoted SSH fixture data grant
no product file/network authority. Secret scanning excludes downloaded SwiftPM/npm
caches while retaining product native sources and other build output.

## Release handoff

[ReDevPlugin artifact gates](redevplugin-release-gates.md) own publication, native
evidence and closed inventories; [plugin integration](plugin-integration-gates.md)
owns Host, market and renderer behavior. Each artifact-consuming runner installs
pinned Cosign itself. Desktop jobs enable Corepack and install frozen Env App packages
to stage Playwright/QuickJS helpers, without installing browsers or running browser
qualification. Bundle exit traps capture the exact staging path and preserve original
failure status under Bash 3.2 and Linux Bash.

Protected `redeven-release` supplies signing, notarization, Sparkle and Team ID secrets.
Desktop exposes only a credential-free HTTPS feed and public updater key. Native macOS
verification binds App, framework, bridge and DMG to architecture, Team ID, hardened
runtime and notarization. The final DMG must receive Apple's Accepted result and be
stapled/validated before receipts or feeds. The App's stapled ticket and native
`syspolicy_check distribution` must pass.

Stable releases sign two non-delta Sparkle appcasts and release notes, verify their
signatures and remove temporary keys. Prereleases omit stable feeds; the collector
rejects them. Linux publishes architecture-matching `latest-linux.yml`. Installers,
feeds and notes join aggregate checksums and remote readback before publication.
[Self-contained installation](self-contained-installer.md) owns bootstrap pins,
suite activation and separate guarded default-version promotion.

# Boundaries

CI confirms a validated pushed tip. Unreleased upstream bytes, sibling wiring,
internal Floret imports, host access to Floret-owned schema, partial evidence and
mutable configuration cannot become release provenance. Gateway and Runtime/Desktop
compatibility use checked-in contracts, not release-note conditionals. Regenerate
contracts, lockfiles and assets from their owners. Browser screenshots, Vitest
attachments and named `.cache` evidence remain ignored; source fixtures stay tracked.

# Evidence

- `redeven:.githooks/pre-commit` and `redeven:.githooks/pre-push`: staged checks and exact-main admission.
- `redeven:scripts/check_quick_ci.sh`, `redeven:scripts/check_final_integration.sh` and `redeven:scripts/quick_ci_policy.test.mjs`: bounded scopes and source-policy regression.
- `redeven:scripts/check_go_version_consistency.mjs` and `redeven:scripts/node_toolchain_contract.test.mjs`: authoritative toolchain pins.
- `redeven:scripts/check_staged_third_party_notices.test.mjs` and `redeven:scripts/check_staged_viewer_assets.test.mjs`: partial staging and offline checks.
- `redeven:internal/envapp/ui_src/scripts/buildEnvApp.node-test.mjs`: build serialization, compression and cleanup.
- `redeven:scripts/security_scan_boundaries.test.mjs`: descriptor-bound identity and pins.
- `redeven:scripts/check_desktop_electron_test_runtime.sh` and `redeven:desktop/src/build/desktopPreloadRuntime.test.ts`: exact Electron preflight and isolated bridges.
- `redeven:.github/workflows/release.yml` and `redeven:.github/workflows/flower-history-qualification.yml`: same-commit history and publication.
- `redeven:.github/workflows/codeql.yml`: asynchronous changed-main analysis.
- `redeven:scripts/check_readme_localizations.mjs` and `redeven:scripts/okf/check_source_integrity.sh`: documentation integrity.
