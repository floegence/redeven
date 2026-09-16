---
type: Acceptance Contract
title: Computer use product qualification
description: Establish scope-specific evidence for decoded frames, real target input, control handback and isolated cleanup.
tags: [ai, computer-use, desktop, testing]
timestamp: 2026-09-16T00:00:00Z
---
# Summary

Redeven qualifies Computer use through the actual product renderer, Runtime,
media decoder and target adapter. A passing scenario proves only its declared
target and provider scope. Fixture outcomes, decoded pixels and cleanup are
required evidence; successful HTTP responses or tool metadata alone are
insufficient. Failed input and uncertain effects must never be replayed to
manufacture a passing result.

# Contract

Desktop qualification observes the preload workspace stream; Linux Webtop uses
CDP's passive HTTP workspace stream copy. Both run the same Composer scenarios
and hash decoded Stage Blob bytes, requiring matching thread, target and image
hash across multiple live events in every turn. Animated fixture markers prove
pixels change without more model actions. Observation stops before private
takeover; reports exclude image bytes and private input. A missing native or
browser live-frame match fails that scope.

`scripts/check_computer_use_webtop.sh` is an opt-in Linux browser and X11 UI
qualification entrypoint. It requires the local DeepSeek configuration and an
explicit verified Linux plugin runtime artifact directory. It builds with
`GOWORK=off`, stages the production browser bundle in Debian Webtop, imports
the isolated Runtime CA into the container browser, and drives Flower through
visible navigation and Composer controls. Runtime sockets and credentials live
in the container filesystem. The desktop, browser, fixtures, and all input stay
inside the task-owned container; cleanup removes that container, temporary
bundles, and credential copies and verifies source secrets and port release.
Cleanup waits for exact container-ID absence because Docker stop and removal
acknowledgements can precede automatic deletion. Inventory failure or timeout
fails the run. The report retains the Runtime, computer bundle, and plugin
verification descriptor hashes after temporary binaries are removed.
An optional `REDEVEN_NODE_ARCHIVE` reuses a downloaded Linux archive; it must
match the current `.node-version`, architecture, and official SHA-256 before
execution. Network downloads are bounded and unused source-package indexes
are excluded from this binary-only fixture environment. Setup has a ten-minute
deadline. An explicit `REDEVEN_COMPUTER_WEBTOP_DEBIAN_MIRROR` may select an HTTPS
Debian mirror origin; it is recorded in the manifest and retains APT signature
verification. There is no automatic mirror fallback. Unused Docker and
NodeSource repositories from the base image do not participate in setup.
Its scope includes managed-browser actions, X11 GUI control effects, per-turn
decoded live frames, hidden-viewer persistence, settings and login handback with
rapid ASCII and native Chromium IME submission. It does not qualify native
macOS, connected Chrome, every OS input method, or every sensitive-page and approval scenario.
The shared UI runner also stops canonical takeover and an outstanding browser
navigation through Flower's Stop button. Ordinary cancellation requires no
appended Stop message or error card. Dispatched navigation instead requires
`floret_effect_outcome_unknown`, a visible safety warning and no replay action;
the fixture must receive exactly one navigation. Both retain the cancellation
fact, restore the composer and allow an explicit visual follow-up in the same
thread. `REDEVEN_COMPUTER_UI_SCENARIO=lifecycle` runs only this focused UI scope
and records it separately; it cannot qualify the complete browser/X11 matrix.
The Linux fixture publishes its observable JSON state atomically so readers
never accept or skip a partial write. The held navigation fixture makes
the interruption observable without injecting model calls or bypassing the
production adapter. Each scenario records its own result; an earlier passing
browser turn cannot substitute for a failed cancellation or follow-up.

The Linux runner additionally checks isolation and recovery through Composer,
the visible Fork menu and public media APIs. An unrelated thread must receive
404 for the parent's keyframe and show no stale Stage. A fork must inherit the
authorized keyframe and support a new visual task. A verified container Runtime
PID is gracefully restarted against the same state; media hashes, decoded Blob
pixels and cross-thread rejection must survive, followed by a real browser
turn. No test reads Floret-owned storage. `REDEVEN_COMPUTER_UI_SCENARIO=recovery`
runs this focused scope, and the complete Linux suite includes it. Replacement
Runtime shutdown and container cleanup remain mandatory on failure as well as
success.

After cleanup the runner writes `acceptance-summary.json`. Scope, frozen commit,
artifact hashes, real provider/image evidence, required scenario results and
cleanup must all match before that scope passes. A focused report cannot satisfy
the complete Linux matrix. Missing evidence, provider rejection, retained
programs or ports, and private-data exposure fail closed even if earlier UI
steps succeeded. The summary names the other product scopes it does not qualify.
The observing proxy drains response streams through an awaited pipeline. An
upstream disconnect propagates to Flower and records a sanitized interruption;
it must not crash the harness before thread evidence is captured. Downstream
user cancellation closes the upstream body without pretending the provider
failed. HTTP 200 alone does not prove a completed stream, and the proxy never
replays a request to turn transport failure into success.

## Private preview and handback

`checkDesktopPrivateComputer.mjs` runs against an explicitly identified,
task-owned Desktop built from the current checkout. Its provider is deterministic;
the Runtime, managed browser helper, workspace stream, private IPC and decoder
remain production implementations. It verifies ordinary preview after unchanged
samples, a 600ms delayed private page change at default 3 FPS, all FPS choices,
client persistence, narrow header placement, private text and native Chromium
IME, rejected handback and one safe continuation without navigation replay.
Only presentation diagnostics and outcome facts are reported. Test threads and
fixture servers are removed on exit; the owner of the isolated Desktop launch
must stop its exact process tree and verify port release.

# Boundaries

This acceptance contract does not grant target authority or replace the
[media contract](computer-use-media.md) or
[canonical takeover boundary](computer-use-takeover.md). Scripted provider
qualification does not prove a real provider's tool choice or image reasoning.
Google verification is an optional human check, never an automated dependency.
Private user pixels and input must stay out of logs and retained evidence;
synthetic fixture outcomes may be recorded without their input or image bytes.

# Evidence

- `redeven:internal/envapp/ui_src/scripts/checkDesktopComputerStage.mjs` - Built Desktop and Linux scenarios with actual provider and pixel evidence.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopPrivateComputer.mjs` - Deterministic provider with real Desktop takeover, frames and handback.
- `redeven:scripts/check_computer_use_webtop.sh` - Isolated Linux product qualification and cleanup.
- `redeven:internal/envapp/ui_src/scripts/computerViewerInteraction.mjs` - Published floating window and launcher interaction checks.
