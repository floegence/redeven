---
type: AI Tool Contract
title: Computer and browser use runtime
description: Route typed computer and browser actions to explicit browser, virtual desktop, or host desktop targets while preserving screenshots, provenance, permissions, and replayable opaque attachments.
tags: [ai, computer-use, browser-use, targets, attachments]
timestamp: 2026-09-15T00:00:00Z
---
# Summary

Redeven exposes computer and browser use as typed functions. Calls use logical `current`; the service resolves it through the target registry and keeps the concrete ID in provenance. A managed browser is the default and uses absolute packaged paths or explicit configuration. Helpers must complete a readiness handshake before targets become ready. Flower Settings keeps computer/browser use enabled by default but lets users turn it off for future runs. Durable Floret state stores text and opaque attachment descriptors, while screenshot bytes stay behind the host resolver. Setup, permission, connection, executor, readiness, and policy failures remain distinct fail-closed states with repair metadata.

# Contract

Desktop and Runtime negotiate compatibility epoch 17 for the media reference
and binary-loading contract. Older Desktop decoders reject unknown Activity
fields, so mixed versions must be rejected during attachment, before a thread
is displayed. The existing model catalog and earlier upgrade paths remain.
Floret provider context projection v9 rebuilds earlier media request snapshots
once from canonical descriptors without relaxing subsequent prefix checks.

The supported functions are `computer.screenshot`, `computer.click`, `computer.double_click`, `computer.type`, `computer.key`, `computer.scroll`, `computer.wait`, `browser.navigate`, `browser.back`, and `browser.reload`. Coordinates are CSS viewport coordinates; a target adapter converts them to physical coordinates when required. Observation requires readonly capability. Input, navigation, and reload use the existing interaction/mutation permission and approval path; `full_access` skips per-action approval without skipping argument, capability, target, or cancellation checks.

`BrowserTarget` uses a persistent Playwright context and is valid on a headless Linux server. Its packaged JSONL helper is shipped beside the Runtime under `computer/` and announces capabilities before requests are accepted. Native desktop input and screenshot adapters are usable only when their helper handshake and macOS permissions succeed. Linux `xvfb.desktop` owns a private Xvfb display, Xauthority, window manager, X11 input commands, and root-window PNG capture; readiness waits for the authenticated X11 socket within the startup deadline, then requires geometry and decoded-capture probes. This bounded startup observation never retries a user action. No target may silently fall back to the Redeven control surface or to `web_fetch` for an interactive task.

Each managed-browser response must match both the outstanding request ID and
target ID. Cancellation, timeout, malformed responses, and transport failures
retire the session and reap its helper before another action can start. An
interrupted action is not replayed automatically. A later observation starts
a fresh browser session with the same profile. Closing the executor reaps its
helpers and permanently rejects new actions. Readiness requires protocol
version 1; the presence of a helper file alone is not handshake evidence.

Each successful action returns target ID, target display name, execution location, an action summary, a safety decision, and an after-frame attachment. Attachment descriptors contain an opaque `computer://` resource reference, MIME, byte size, and SHA-256. Provider renderers resolve bytes only at request time; durable state stores descriptor and hash, never base64. A resolver error, unknown reference, changed bytes, or unsupported model capability is an explicit error.

Before execution, the interaction safety gate combines deterministic target/action signals with optional screenshot or accessibility classifiers. Secret input, login, CAPTCHA, prompt injection, external side effects, and unknown states may require user takeover; the model cannot override a gate decision. Takeover decisions suppress capture and model forwarding for secret input.

Flower publishes target actions on its existing workspace stream as ordinary tool Activity. The activity renderer shows target, action, execution location, approval state, and the latest screenshot attachment. Structured target errors include the target kind, readiness state, and a repair action so the UI can explain setup, permission, connection, and takeover recovery instead of asking the user to guess a target. Live frames are target-scoped ephemeral media and do not create a second lifecycle stream or polling loop.

The floating Stage is a media-only viewer: it displays the latest action screenshot and a close icon, without internal state labels or explanatory text. It opens when an Activity contains a frame reference, not for an empty tool-start payload. Closing only hides it; thread selection resets its presentation state. After the first successful action, Runtime may publish target-scoped live frame metadata at approximately 3 FPS through the existing workspace stream. Each workspace subscriber retains at most one pending media descriptor (maximum 4 KiB), replacing stale media without consuming lifecycle queue capacity. Lifecycle delivery has priority. The sampler stop waits for capture to exit, and an old stop cannot cancel a replacement session. The viewer requests capture through its authenticated workspace observer and the thread media endpoint can resolve that active session's bounded samples. Completion, viewer hiding, thread or target changes, and disconnect retire live samples in the UI; the viewer then resolves the durable action keyframe. Reopening must never prefer a retired live reference over that keyframe. Continuous viewing and sensitive-page suspension still require their complete product qualification; decoded action frames alone do not prove continuous-view support.

Screenshot identity crosses Floret v7.11.2's published `ActivityPresentation.target_refs` boundary as `kind: computer_frame`, with a `computer://<target>/<sha256>` opaque `resource_ref` and target display label. Navigable `uri` is not the media contract. The renderer remains `structured`; custom frame fields do not belong to its closed payload. Redeven's public timeline sanitizer preserves only hash-addressed computer frame references under that kind. Both Env App and Desktop Welcome resolve the same reference through the authenticated thread media endpoint into a short-lived Blob URL. Desktop uses its existing authorized Runtime IPC request channel to carry PNG bytes as `Uint8Array`; runtime credentials stay in main. No opaque reference is assigned directly to an image source, and no HTTP image fallback bypasses this boundary.

Tool-result images must survive Floret's model request snapshots and the Redeven provider adapter: nested Floret tool attachments are resolved, checked against model capabilities, and mapped back into `ToolResult.Attachments` before the published DeepSeek renderer emits `function_call_output` image parts. A model receiving only a textual screenshot reference does not qualify as visual execution. The Settings switch removes typed computer/browser functions from newly prepared tool registries when disabled.

User initiated Stop is a control action, not a transcript message. The service records the canonical cancellation fact, audit entry, and safety outcome, while Flower clears the transient stop affordance after acknowledgement and leaves completed messages and keyframes intact. An unconfirmed external effect remains a visible safety error because it requires the user to verify the outcome and must not be replayed automatically.

DeepSeek Vision Experimental is qualified through typed function tools only. Requests use `deepseek-v4-flash-vision-exp`, include screenshot input and `function_call_output` image parts, and never register the native `computer_use` tool.

DeepSeek budget admission and streaming use the same prepared request from
published Floret v7.11.2. Visual input uses the upstream image token bound;
base64 transport bytes are not counted as ordinary text. The Redeven adapter
maps product data and preserves admission, cancellation, and event semantics;
it does not independently estimate the DeepSeek intermediate DTO. Large images,
tool results, and replay must retain their exact transmitted bytes.

Desktop development snapshots and installers consume the same computer resource
inventory, bound by SHA-256 to bundle manifest schema 5. The build includes a
checksum-verified official Node distribution, complete Playwright packages,
Chromium distribution and native helper. Framework symlinks must remain inside
the Chromium subtree. Runtime configuration uses absolute bundle paths, never
source paths or a PATH lookup. Desktop validates the closed inventory before
startup. Missing dependencies fail the build rather than producing an empty
resource set. Helper startup reports only closed reason codes, never CDP
credentials or raw Playwright startup exceptions. Native screen capture excludes
the Desktop window owner's windows to prevent viewer recursion. macOS 14 and later use ScreenCaptureKit application exclusion; macOS 13 uses filtered window composition. A failed filtered capture never falls back to the unrestricted display, and invalid exclusion configuration fails closed.

Node archive acquisition belongs to the Redeven builder. Each build retrieves
the official version-specific checksums and verifies the archive before use.
Verified archives are published atomically under
`${XDG_CACHE_HOME:-$HOME/.cache}/redeven/node-archives`, keyed by checksum and
archive name. This build cache is never a runtime dependency. A corrupt cache
entry is removed and downloaded again; failed or mismatched downloads never
become cache entries. Archive transfers have a 30-second connection timeout and
fail when the rate stays below 1 KiB/s for 60 seconds, with no total deadline
for a progressing transfer. Transient transport failures resume the current
build's temporary archive, with at most three attempts; HTTP rejection and
checksum mismatches fail without retry. `REDEVEN_NODE_ARCHIVE` may select a
complete local official archive, but it must pass the same official checksum
verification and is never silently replaced by a download.

# Qualification boundary

The smoke launcher canonicalizes one per-run root before creating state, exporting configuration, or recording process and port ownership. The metadata writer verifies the actual immutable bundle under that state root and preserves the model and port arguments without positional drift. Tests execute the production metadata writer; syntax-only checks do not establish launch provenance.

The Desktop qualification records the thread selected by the actual Composer,
not the first entry in a thread listing. It verifies all ten typed actions,
observable fixture effects, decoded Stage pixels, media provenance, reopening
the viewer, and the settings switch. Failure cancels the qualification thread
before closing its fixture and provider proxy. Its default success scope is `managed-browser-desktop-ui`. The explicit macOS native suite additionally checks native control effects and `desktop-main` Stage pixels across three turns; a terminal model response without the expected fixture result is a failure. Native fixture evidence records control events and pointer coordinates without retaining typed secrets. The login case uses semantic action selectors independent of Desktop language and verifies the actual private field values at its fixture endpoint before accepting submission. Every new thread must execute against a target released by the prior completed thread; a model reply alone cannot prove target reuse. Failure evidence identifies the currently selected thread and masks the Stage to exclude private user pixels. Neither scope is acceptance of connected Chrome, Xvfb, all takeover scenarios, or continuous video.

On macOS, browser and native adapters register independently as unready.
The Computer Use Runtime checks readiness after target authorization and before
execution; only a real browser startup or native permission handshake marks a
target ready. File presence and CDP configuration do not grant readiness. The native
Swift helper validates permissions, emits balanced
mouse/keyboard events, moves the pointer before clicking, compensates for the
system natural-scrolling preference, and captures a normalized display frame.
The native executor owns the helper across tool-call contexts and reaps it on
interrupted exchanges or shutdown. Electron supplies packaged resource paths
and UI; it does not run a second native helper owner. The Xvfb executor is the Linux input/capture implementation and reaps its display process group with the Runtime. It has no non-Linux forwarding wrapper or PATH-based fixture executor. Its opt-in Linux test drives an actual xterm window, verifies the entered text, and checks child reaping and session-authority removal; this is adapter evidence rather than acceptance of remote Flower viewing.
The default safety gate uses target
metadata and action arguments; real page/password/OTP detection and a complete
user takeover flow require separate implementation and qualification. These
limitations must not be reported as completed platform or safety support.

# Explicit browser connection

The current Chrome connection form is an advanced CDP endpoint entry, not an
extension-based tab authorization flow. Only a successful readiness handshake
publishes a replacement executor. Failed connections preserve the existing
session; successful replacements reap the previous helper. Connect and shutdown
are serialized, and a closed runtime rejects new connections. Flower retains
failed input, reports a localized error without raw transport secrets, and shows
a ready result only for a ready descriptor. Both shipped locale catalogs carry
the same explicit messages. Disconnect, revocation and ordinary extension setup
remain required for complete connected-browser qualification.

# Boundaries

The target registry currently owns runtime-level logical target resolution;
thread-specific bindings remain an unqualified implementation requirement.
executors own browser, virtual desktop, and host desktop lifecycles. Flower owns
presentation of action observations, while the workspace stream and attachment
resolver remain the canonical transport and media boundaries. The provider may
expand an opaque attachment only through the resolver; it does not receive
durable screenshot bytes or target-control authority.

# Evidence

- `redeven:internal/ai/target_tool_policy.go` - typed target routing, capability requirements, and opaque attachment descriptors.
- `redeven:internal/ai/target_registry.go` - model-safe `current` alias and target readiness snapshots.
- `redeven:internal/ai/computer_target_executor.go` - headless Playwright JSONL executor and attachment resolver.
- `redeven:internal/ai/computer_target_executor_test.go` - interrupted-session retirement, response correlation, process reaping, and real browser action effects.
- `redeven:internal/ai/desktop_target_executor.go` - native Desktop JSONL executor and screenshot attachment resolver.
- `redeven:internal/ai/virtual_desktop_target_linux.go` - private Xvfb lifecycle, X11 actions, and screenshot validation.
- `redeven:internal/ai/floret_runtime.go` - target attachment expansion at the provider boundary.
- `redeven:internal/ai/service.go` and `redeven:internal/codeapp/appserver/server.go` - authenticated, hash-checked Flower media resolution boundary for computer frames.
- `redeven:internal/flower_ui/src/FlowerComputerStage.tsx` - Blob URL lifecycle and explicit unavailable-frame rendering.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - browser-level evidence that a `computer://` frame reaches the floating Stage resolver.
- `redeven:internal/ai/activity_timeline_test.go` - screenshot references survive Floret JSON serialization and public timeline filtering.
- `redeven:internal/ai/model_gateway_deepseek_test.go` - the production adapter preserves nested tool images through the DeepSeek wire renderer.
- `redeven:internal/ai/floret_provider_prepared_test.go` - large desktop image budgeting, exact wire fingerprint, and single admission/resolution through the published prepared request.
- `redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx` - Desktop Welcome media loading through authorized IPC.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopComputerStage.mjs` - opt-in built Desktop qualification through Composer, real DeepSeek, fixture completion, decoded Stage pixels, and provider image-output evidence.
- `redeven:scripts/check_macos_computer_host_fixture.sh` - real AppKit controls and scroll offset after input, with bounded helper waits and process cleanup on success, failure, and cancellation.
- `redeven:internal/agent/agent.go` - absolute helper discovery and independent browser/native registration.
- `redeven:desktop/electron-builder.config.mjs` - shared immutable computer resources for the packaged shell.
- `redeven:internal/ai/computer_runtime.go` - single adapter lifecycle and readiness owner.
- `redeven:scripts/stage_computer_resources.test.mjs` - relocated resource bundle with empty browser cache and no source/PATH dependency.
- `redeven:scripts/resolve_node_archive.test.mjs` - progressing downloads, verified cache reuse, failure cleanup, and explicit archive verification.
