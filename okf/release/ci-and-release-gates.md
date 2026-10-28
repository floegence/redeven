---
type: Release Contract
title: CI and release gates
description: Redeven binds published dependencies, generated assets, UI behavior, release payloads, tests, and OKF to the exact main tip being pushed.
tags: [release, ci, quality, okf]
timestamp: 2026-10-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Redeven runs focused development checks, a fast staged pre-commit gate and one
bounded integration gate for the exact main tip being pushed. Published
dependencies, generated assets, localization, compatibility and OKF must agree.
[Long-thread correctness and responsiveness](../operations/flower-long-thread-gate.md) run as explicit acceptance, outside unified commit, integration and CI gates. Broad browser, Desktop, Docker and native qualification also run explicitly;
release packaging additionally requires same-commit historical conversation
evidence and authenticated target-specific artifacts. Windows remains an internal
certification target and cannot enter the formal release inventory.

# Contract

## Checks and provenance

AGENTS.md owns Git workflow/100-line limit and links domain rules; quick_ci_policy.test.mjs enforces this. Development runs affected checks; pre-commit checks staged diff, localization, hygiene and affected notices/viewer assets. Ordinary push/PR runs one bounded source-only job. Main pre-push runs check_final_integration.sh once for the exact clean rebased base/tip. Long-thread browser/Electron acceptance is explicit and does not register a commit or full-profile group. Broad UI/Docker/native/stress qualifications also run explicitly. Releases additionally require target artifacts and same-commit historical-conversation Actions evidence.

Pre-push checks current local main equals pushed tip, handshake ancestry is fast-forward, and no unpublished merge commits. Earlier evidence cannot certify changed tips. Fingerprints include tools/inputs, excluding macOS-variable MANPATH; real-hook tests guard reuse. Generators leave no diff; formatting lists all offending paths before expensive checks.

Staged notices read a temporary index snapshot (including partial staging), installed metadata and cached exact Go with GOTOOLCHAIN=local, no proxy/SumDB/VCS downloads. Missing prerequisites/stale output blocks commit; cleanup cannot rewrite index/worktree. Viewer verification uses staged source/locked installed dependencies without install/generation; buildHostApplicationAppearance.mjs alone generates assets.

Daily/manual CodeQL is separate: unchanged main since successful scheduled scan skips matrix; failed lookup scans. Review current source/all locks; dismissal needs specific authority/input evidence. Unavailable/nonzero scanning is not clean. Actions use reviewed commit pins; their Node24 runtime is independent of product Node.

## Build ownership

go.mod owns exact Go patch; .node-version owns first-party Node. Gates, engines and README prerequisites/badges match. Desktop pnpm allows electron/esbuild lifecycle only; electron-winstaller is ignored for internal NSIS. Dependency changes regenerate/check notices.

README locales preserve structure/links/literals/terms/sync hashes, not reviewer counts. OKF bundle/manifest/checksum commit together. Build embedded UI before Go embed consumers. Env App flock spans cleanup/typecheck/Vite/budgets/compression and releases with build processes; same-checkout builds wait, worktrees do not. build_assets.sh cannot compress outside the lock or skip missing output.

Shipped Runtime uses cgo/floeterm_native, native Linux/Darwin amd64/arm64 and released terminal-go. Untagged live attachment fails closed. Release/Desktop/SSH/carrier source contracts include macOS Bash3.2 strict arguments. Main checks build contracts; native execution is explicit qualification.

## Qualification and security

flower-history-qualification.yml continues copied immutable released-writer data through public product APIs and repeats after restart. Release-ref requires same-commit successful Actions; ordinary CI/main only verify fixture source. [Historical upgrades](../ai/flower-upgrade-compatibility.md) owns preservation/recovery.

UI acceptance uses canonical headless browser/carriers and fresh exact-source assets, not ignored dist/headed diagnostics. [Web dependencies](../architecture/env-app-upstream-web-dependencies.md) owns modes. Renderer-only Floe tests use client Vitest/browser resolution/DOM and keep real utilities except at tested boundaries. Fixtures retain scrollbars/space geometry and await after-paint focus restoration. PDF drag removes/restores runner preview scale only.

[Desktop lifecycle](../desktop/desktop-test-lifecycle.md) owns process cleanup. Electron preload tests isolate work, utility and session paths; stop only owned POSIX groups/Windows trees and drain. External SIGKILL fails. Preflight executes pinned node_modules Electron; AMFI/signal rejection is environment failure, never grounds to sign/alter trust/dependencies. Windows certification uses exact origin/main, Linux amd64 Runtime and two isolated WSL2 distros; verify install/Start/Bridge/external-stop/Retry/Update/exact Stop before internal unsigned NSIS. Only fixture cleanup unregisters its distros.

Security reads/hash/consumption share one no-follow descriptor for signed manifests, logs, source identity, installer pins, Sparkle keys and credentials; source capture verifies enumerated inode, with replacement tests. Computer proxy accepts fixed Responses POST only. Terminal TLS exceptions require isolated run CA. Diagnostics are bounded single-line. Reports/synthetic secrets/quoted SSH data grant no authority. Secret scans omit downloaded SwiftPM/npm caches, retaining product native/build files.

## Release handoff

[Plugin artifact gates](redevplugin-release-gates.md) own publication/evidence/inventory; [integration](plugin-integration-gates.md) owns Host/market/UI. Consuming runners install pinned Cosign. Desktop jobs use Corepack/frozen Env App dependencies to stage Playwright/QuickJS without browser download/qualification. Bundle traps retain exact staging path and original failure under Bash3.2/Linux.

Protected redeven-release supplies signing/notarization/Sparkle/Team ID secrets; Desktop exposes credential-free HTTPS feed/public key. Verify App/framework/bridge/DMG architecture, Team ID, hardened runtime and notarization. DMG requires Accepted/stapled validation before receipts/feeds; App ticket and syspolicy_check distribution pass.

Stable releases sign two non-delta Sparkle appcasts/notes, verify and remove temporary keys. Prereleases omit stable feeds; collector rejects them. Linux feeds match architecture. Installers/feeds/notes join aggregate checksums/remote readback before publication. [Installer](self-contained-installer.md) owns pins, activation and separately guarded promotion.

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
