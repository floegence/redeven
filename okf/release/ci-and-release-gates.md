---
type: Release Contract
title: CI and release gates
tags: [release, ci, quality, okf]
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

AGENTS.md owns Git workflow/100-line cap; quick_ci_policy.test.mjs enforces it. Development checks affected behavior; staged pre-commit checks localization/hygiene/notices/viewer assets. Ordinary push/PR has one bounded source job. Main check_final_integration.sh runs once for exact clean rebased base/tip, verifying pushed tip equals local main, fast-forward ancestry and no unpublished merges. Earlier evidence cannot certify changed tips. Fingerprints bind tools/inputs except variable macOS MANPATH; real-hook tests guard reuse. Formatting lists all offenders before expensive checks; generators leave no diff.

Long-thread/browser/Electron and broad UI/Docker/native/stress run explicitly, outside unified profiles. Releases additionally require authenticated target artifacts and same-commit historical-conversation Actions.

Staged notices use an index snapshot (including partial staging), installed metadata and exact cached Go/GOTOOLCHAIN=local without network. Missing prerequisites/stale output blocks commit; cleanup never rewrites index/worktree. Viewer verification uses staged source/locked installed dependencies without install/generation; buildHostApplicationAppearance.mjs alone generates.

Daily/manual CodeQL is separate: unchanged main since successful schedule skips; failed lookup scans. Review source/all locks; dismissal requires specific authority/input evidence. Unavailable/nonzero scan is not clean. Reviewed Actions commit pins/Node24 are independent of product Node.

## Build ownership

go.mod owns exact Go patch/.node-version first-party Node; gates/engines/README agree. Desktop pnpm permits only electron/esbuild lifecycle; electron-winstaller ignored for internal NSIS. Dependency changes regenerate/check notices. README locales preserve structure/links/literals/terms/hashes, not reviewer counts. Commit all three OKF artifacts.

Build embedded UI before Go consumers. Env App flock spans cleanup/typecheck/Vite/budgets/compression and lasts through builds; same checkout waits, separate worktrees do not. build_assets.sh cannot compress outside lock/skip missing output.

Runtime ships cgo/floeterm_native on native Linux/Darwin amd64/arm64 with published terminal-go; untagged live attachment fails closed. Release/Desktop/SSH/carrier contracts cover macOS Bash3.2 strict arguments. Main verifies source contracts; native execution remains explicit.

## Qualification and security

flower-history-qualification.yml continues copied immutable released-writer data through product APIs/restart. Release-ref requires same-commit successful Actions; ordinary gates verify fixture source only. [Upgrade contract](../ai/flower-upgrade-compatibility.md) owns preservation/recovery.

Use canonical headless carriers/fresh exact-source assets, not ignored dist/headed diagnostics. [Web dependencies](../architecture/env-app-upstream-web-dependencies.md) owns modes. Floe renderer tests use client Vitest/browser DOM resolution and real utilities except tested boundaries. Preserve scrollbar/space geometry and wait for after-paint focus; PDF drag restores temporary runner-scale removal.

[Desktop lifecycle](../desktop/desktop-test-lifecycle.md) owns cleanup. Preload tests isolate work/utility/session paths; stop/drain owned POSIX groups or Windows trees only. External SIGKILL fails. Preflight runs pinned Electron; AMFI/signal rejection is environment failure, not permission to resign/change trust/dependencies. Windows qualification uses exact origin/main, Linux amd64 Runtime/two owned WSL2 distros, verifying install/Start/Bridge/external-stop/Retry/Update/exact Stop before unsigned internal NSIS. Only owned fixture cleanup unregisters distros.

Signed manifests/logs/source identity/installer pins/Sparkle keys/credentials use one no-follow descriptor for read/hash/consume; source captures verify enumerated inode with replacement regressions. Computer proxy allows fixed Responses POST only. Terminal TLS exceptions need isolated CA. Diagnostics are bounded single-line; reports/synthetic secrets/quoted SSH data confer no authority. Secret scanning excludes downloaded SwiftPM/npm caches but retains native/build product files.

## Release handoff

Web Center joins Runtime and Desktop under the same tag as independently installable Linux amd64/arm64 archives. Native Center jobs build a static binary with exact version/commit/time, and package the UI, licenses and deployment templates. The closed collector requires both Center archives and matching digest receipts from the release commit. Missing or mismatched Center artifacts block publication; archives/receipts join signed aggregate checksums and remote readback. [Center deployment](../operations/web-center-deployment.md) owns installation and upgrade details. No tag creation or successful CI run alone claims completion of long-duration or physical-device qualification.

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
