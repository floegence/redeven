---
type: Release Contract
title: CI and release gates
tags: [release, ci, quality, okf]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Focused checks precede staged pre-commit and exact-tip main admission. Long-thread/browser/Electron/broad UI/Docker/native/stress remain explicit. Release requires authenticated artifacts and same-commit historical-conversation Actions. Staged notices use index snapshot/installed metadata/cached exact Go with GOTOOLCHAIN=local, no network/index rewrite.

# Contract

## Checks
AGENTS owns workflow/100-line cap; quick_ci_policy enforces it. Development checks affected code; pre-commit checks staged locale/hygiene/notices/viewer bytes. Ordinary CI has one bounded source job. check_final_integration.sh runs once per exact clean rebased base/tip: pushed object=main, fast-forward ancestry, no unpublished merges. Earlier evidence cannot certify changed inputs. Fingerprints bind tools/inputs except variable macOS MANPATH; real-hook tests verify identity. Report all formatting faults; generators leave no diff.

Main checks full notices with GOWORK=off; dev startup skips. Floe notices match manifests/locks. Viewer validates staged source/locked deps without install/generation; buildHostApplicationAppearance.mjs generates.

Daily/manual CodeQL skips unchanged main only after successful scheduled scan; lookup failure scans. Review source/locks; dismissals need exact authority/input evidence. Unavailable/nonzero is not clean. Actions pins/Node24 are separate from product Node.

## Build
go.mod owns exact Go patch, .node-version first-party Node; gates/engines/README agree. Desktop allows Electron/esbuild lifecycle only; ignores electron-winstaller for internal NSIS. Dependency changes regenerate notices. README locales preserve structure/terms/hash; images have actual Runtime/shared provenance/localized alt. Hygiene permits exact root public URLs only, not variants/copied implementations. Commit three OKF artifacts.

Build UI before Go embeds. Env checkout lock covers cleanup/typecheck/Vite/budgets/compression; worktrees independent. build_assets cannot compress unlocked/missing output. Runtime Linux/Darwin amd64/arm64 uses published cgo/floeterm_native; untagged attachment rejects. Bash3.2 argument contracts tested; native execution remains explicit.

## Qualification/security
History workflow opens copied immutable released-writer fixtures via public API/restart; release needs same-commit pass, ordinary checks validate provenance. [Upgrade](../ai/flower-upgrade-compatibility.md) owns retention. Use fresh canonical headless carriers per [dependency contract](../architecture/env-app-upstream-web-dependencies.md); Floe tests use real client/browser except declared boundaries. Preserve geometry/after-paint focus; PDF drag restores temporary scale.

[Desktop lifecycle](../desktop/desktop-test-lifecycle.md) owns isolated preload/session/work paths and exact process-group/Windows-tree cleanup. External SIGKILL fails. Pinned Electron AMFI/signal failures are environmental: never resign or change trust/deps. Internal Windows qualification uses exact origin/main, Linux Runtime/two owned WSL distros and install/Start/Bridge/external-stop/Retry/Update/exact Stop before unsigned NSIS; unregister only owned distros.

Read/hash/use manifests/logs/source/pins/keys/credentials through one no-follow descriptor with inode checks. Computer proxy allows fixed Responses POST only; terminal TLS exceptions require isolated CA. Bounded one-line diagnostics/synthetic data/quoted SSH grant no authority. Secret scan skips dependency caches, not native/product build files.

## Release
Center shares tag but installs separately: native Linux amd64/arm64 static binaries, exact identity/UI/licenses/templates/same-commit digest receipts. Missing/mismatch blocks collector; checksums/readback include both. [Deployment](../operations/web-center-deployment.md) owns operation; tags/CI prove no soak/device acceptance.

[Plugin artifacts](redevplugin-release-gates.md)/[integration](plugin-integration-gates.md) own gates. Pin Cosign; Desktop Corepack/frozen Env deps stage Playwright/QuickJS without browser download. Bash3.2/Linux traps retain staging/original failure.

Protected redeven-release supplies signing/notarization/Sparkle/Team secrets; feed/key is credential-free HTTPS. Validate App/framework/bridge/DMG target/Team/hardening/notarization. DMG Accepted/stapled precedes receipt/feed; App ticket/distribution policy pass. Stable emits two signed non-delta appcasts/notes, deletes temporary keys. Prerelease omits feeds and collector rejects them. Linux feed matches target. Installer/feed/notes join signed inventory/readback; [installer](self-contained-installer.md) owns activation/promotion.

# Boundaries

CI certifies validated pushed tip only. No unreleased/sibling/internal-Floret/host-schema access, partial evidence or mutable config as provenance. Checked-in contracts own compatibility, not release-note conditionals. Regenerate owner contracts/locks/assets. Ignore screenshots/Vitest/.cache evidence; track source fixtures.

# Evidence

- `redeven:.githooks/pre-commit`, `redeven:.githooks/pre-push`
- `redeven:.github/workflows/codeql.yml`
