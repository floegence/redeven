---
type: Release Contract
title: CI and release gates
tags: [release, ci, quality, okf]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Focused development checks precede staged pre-commit and exact-tip main admission. Dependencies, generated assets, locales and OKF must agree. Long-thread, browser, Desktop and native acceptance stay explicit; release needs authenticated artifacts and same-commit historical data qualification. Windows remains internal-only.

# Contract

## Checks and provenance
AGENTS owns workflow/100-line cap, enforced by quick_ci_policy. Development is focused; staged commit checks locale/hygiene/notices/viewer bytes. Ordinary CI has one bounded source job. check_final_integration.sh runs once on exact clean rebased base/tip: pushed object equals main, ancestry fast-forwards, no unpublished merges. Earlier evidence cannot certify changes. Reuse fingerprints bind inputs/tools except variable macOS MANPATH; real-hook tests guard identity. List all formatting errors first; generators leave no diff.

Long-thread/browser/Electron/broad UI/Docker/native/stress remain explicit. Release needs authenticated artifacts and same-commit historical-conversation Actions. Staged notices use index snapshot, installed metadata and cached exact Go with GOTOOLCHAIN=local, no network/index rewrite. Main dependencies check full notices with GOWORK=off; development startup does not. Floe notice artifacts must match manifest/lock versions. Viewer checks staged source/locked deps without install/generation; buildHostApplicationAppearance.mjs owns generation.

Daily/manual CodeQL skips unchanged main only after a successful scheduled run; lookup failure scans. Review source/locks; dismissals need specific authority/input evidence. Unavailable/nonzero is not clean. Actions pins/Node 24 are independent of product Node.

## Build contracts
Exact Go patch comes from go.mod; first-party Node from .node-version. Gates/engines/README agree. Desktop allows only Electron/esbuild lifecycle, ignores electron-winstaller for internal NSIS. Dependency changes regenerate notices. README translations preserve structure/terms/hash; imagery has actual Runtime/shared provenance and localized alt. Root URLs are only the exact public destinations in hygiene allowlist; variants and implementation copies remain blocked. Commit three OKF outputs.

Build embedded UI before Go. Env checkout lock covers cleanup/typecheck/Vite/budgets/compression; same checkout waits, worktrees are independent. build_assets cannot compress unlocked or skip absent output. Native Linux/Darwin amd64/arm64 Runtime uses published cgo/floeterm_native; untagged attachment rejects. Contracts cover Bash 3.2 arguments; main checks source, native execution is explicit.

## Qualification and security
History workflow copies immutable released-writer state through public APIs/restart. Releases require same-commit success; ordinary checks validate fixture provenance. [Upgrade](../ai/flower-upgrade-compatibility.md) owns preservation. Use canonical headless carriers/fresh assets; [web dependencies](../architecture/env-app-upstream-web-dependencies.md) owns modes. Floe tests use real client/browser utilities except stated boundaries. Preserve scroll geometry/after-paint focus; PDF drag restores temporary scale removal.

[Desktop test lifecycle](../desktop/desktop-test-lifecycle.md) owns cleanup. Isolate preload/session/work paths and drain exact owned process groups/Windows trees. External SIGKILL fails. Pinned Electron preflight rejects AMFI/signals as environment failure; never resign/change trust/deps. Windows qualifies exact origin/main, Linux Runtime/two owned WSL distros and install/Start/Bridge/external-stop/Retry/Update/exact Stop before internal unsigned NSIS; only owned distros unregister.

Read/hash/consume manifests, logs, source identity, pins, keys and credentials through one no-follow descriptor, checking inode replacement. Computer proxy permits fixed Responses POST only; terminal TLS exceptions need isolated CA. Single-line bounded diagnostics/synthetic data/quoted SSH confer no authority. Secret scan excludes downloaded dependency caches but retains native/product build files.

## Release
Center shares tag but installs independently: native Linux amd64/arm64 static binaries with exact identity, UI/licenses/templates and same-commit digest receipts. Missing/mismatch blocks collector; checksums/readback include both. [Deployment](../operations/web-center-deployment.md) owns service procedure. CI/tag alone certifies no long-duration/device acceptance.

[Plugin artifacts](redevplugin-release-gates.md) and [integration](plugin-integration-gates.md) own their gates. Consumers pin Cosign. Desktop uses Corepack/frozen Env dependencies to stage Playwright/QuickJS without browser acquisition. Bash 3.2/Linux traps preserve staging and original failure.

Protected redeven-release supplies signing/notarization/Sparkle/Team secrets; public feed/key is credential-free HTTPS. Verify App/framework/bridge/DMG target, Team, hardening/notarization. DMG must be Accepted/stapled before receipts/feed; App ticket and distribution policy pass. Stable publishes two signed non-delta appcasts/notes then deletes temp keys; prereleases omit them and collector rejects feeds. Linux feeds match target. Installer/feed/notes join checksums/readback; [installer](self-contained-installer.md) owns activation and separate promotion.

# Boundaries

CI confirms a validated pushed tip. Unreleased upstream bytes, sibling wiring,
internal Floret imports, host access to Floret-owned schema, partial evidence and
mutable configuration cannot become release provenance. Gateway and Runtime/Desktop
compatibility use checked-in contracts, not release-note conditionals. Regenerate
contracts, lockfiles and assets from their owners. Browser screenshots, Vitest
attachments and named `.cache` evidence remain ignored; source fixtures stay tracked.

# Evidence

- `redeven:.githooks/pre-commit` and `redeven:.githooks/pre-push`: staged checks and exact-main admission.
- `redeven:.github/workflows/codeql.yml`: asynchronous changed-main analysis.
