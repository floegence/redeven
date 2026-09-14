---
type: AI Tool Contract
title: Computer and browser use runtime
description: Route typed computer and browser actions to explicit browser, virtual desktop, or host desktop targets while preserving screenshots, provenance, permissions, and replayable opaque attachments.
tags: [ai, computer-use, browser-use, targets, attachments]
timestamp: 2026-09-14T00:00:00Z
---
# Summary

Redeven exposes computer and browser use as typed functions. Calls use logical `current`; the service resolves it through the thread target registry and keeps the concrete ID in provenance. A managed browser is the default and uses absolute packaged paths or explicit configuration. Helpers must complete a readiness handshake before targets become ready. Flower Settings keeps computer/browser use enabled by default but lets users turn it off for future runs. Durable Floret state stores text and opaque attachment descriptors, while screenshot bytes stay behind the host resolver. Setup, permission, connection, executor, readiness, and policy failures remain distinct fail-closed states with repair metadata.

# Contract

Desktop and Runtime negotiate compatibility epoch 17 for the media reference
and binary-loading contract. Older Desktop decoders reject unknown Activity
fields, so mixed versions must be rejected during attachment, before a thread
is displayed. The existing model catalog and earlier upgrade paths remain.
Floret provider context projection v9 rebuilds earlier media request snapshots
once from canonical descriptors without relaxing subsequent prefix checks.

The supported functions are `computer.screenshot`, `computer.click`, `computer.double_click`, `computer.type`, `computer.key`, `computer.scroll`, `computer.wait`, `browser.navigate`, `browser.back`, and `browser.reload`. Coordinates are CSS viewport coordinates; a target adapter converts them to physical coordinates when required. Observation requires readonly capability. Input, navigation, and reload use the existing interaction/mutation permission and approval path; `full_access` skips per-action approval without skipping argument, capability, target, or cancellation checks.

`BrowserTarget` uses a persistent Playwright context and is valid on a headless Linux server. Its packaged JSONL helper is shipped under the Desktop `computer/` resources directory and announces capabilities before requests are accepted. Native desktop input and screenshot adapters are production-ready only when their helper handshake and macOS permissions succeed; Xvfb still requires an explicit input/capture adapter. No target may silently fall back to the Redeven control surface or to `web_fetch` for an interactive task.

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

The floating Stage is a media-only viewer: it displays the latest action screenshot and a close icon, without internal state labels or explanatory text. It opens when an Activity contains a frame reference, not for an empty tool-start payload. Closing only hides it; thread selection resets its presentation state. Continuous video is not currently published: action keyframes must not be described as a continuous live stream.

Screenshot identity crosses Floret v7.11.1's published `ActivityPresentation.target_refs` boundary as `kind: computer_frame`, with a `computer://<target>/<sha256>` opaque `resource_ref` and target display label. Navigable `uri` is not the media contract. The renderer remains `structured`; custom frame fields do not belong to its closed payload. Redeven's public timeline sanitizer preserves only hash-addressed computer frame references under that kind. Both Env App and Desktop Welcome resolve the same reference through the authenticated thread media endpoint into a short-lived Blob URL. Desktop uses its existing authorized Runtime IPC request channel to carry PNG bytes as `Uint8Array`; runtime credentials stay in main. No opaque reference is assigned directly to an image source, and no HTTP image fallback bypasses this boundary.

Tool-result images must survive Floret's model request snapshots and the Redeven provider adapter: nested Floret tool attachments are resolved, checked against model capabilities, and mapped back into `ToolResult.Attachments` before the published DeepSeek renderer emits `function_call_output` image parts. A model receiving only a textual screenshot reference does not qualify as visual execution. The Settings switch removes typed computer/browser functions from newly prepared tool registries when disabled.

User initiated Stop is a control action, not a transcript message. The service records the canonical cancellation fact, audit entry, and safety outcome, while Flower clears the transient stop affordance after acknowledgement and leaves completed messages and keyframes intact. An unconfirmed external effect remains a visible safety error because it requires the user to verify the outcome and must not be replayed automatically.

DeepSeek Vision Experimental is qualified through typed function tools only. Requests use `deepseek-v4-flash-vision-exp`, include screenshot input and `function_call_output` image parts, and never register the native `computer_use` tool.

# Qualification boundary

The Desktop qualification records the thread selected by the actual Composer,
not the first entry in a thread listing. It verifies all ten typed actions,
observable fixture effects, decoded Stage pixels, media provenance, reopening
the viewer, and the settings switch. Failure cancels the qualification thread
before closing its fixture and provider proxy. Its success scope is explicitly
`managed-browser-desktop-ui`; it is not acceptance of connected Chrome, native
apps, Xvfb, takeover, or continuous video.

The current production constructor selects the native helper only when the
managed-browser helper is absent. On macOS, both adapters are registered when
their helpers are ready and the target registry routes each concrete target to
its own executor. The native Swift helper validates permissions, emits balanced
mouse/keyboard events, and captures a normalized display frame. The Xvfb
executor is a lifecycle wrapper and requires an input/capture implementation.
The default safety gate uses target
metadata and action arguments; real page/password/OTP detection and a complete
user takeover flow require separate implementation and qualification. These
limitations must not be reported as completed platform or safety support.

# Boundaries

The target registry owns logical-to-concrete target resolution for a thread;
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
- `redeven:internal/ai/virtual_desktop_target.go` - Xvfb lifecycle and unavailable-target failure.
- `redeven:desktop/src/main/computerHost.ts` - versioned Desktop helper protocol.
- `redeven:internal/ai/floret_runtime.go` - target attachment expansion at the provider boundary.
- `redeven:internal/ai/service.go` and `redeven:internal/codeapp/appserver/server.go` - authenticated, hash-checked Flower media resolution boundary for computer frames.
- `redeven:internal/flower_ui/src/FlowerComputerStage.tsx` - Blob URL lifecycle and explicit unavailable-frame rendering.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - browser-level evidence that a `computer://` frame reaches the floating Stage resolver.
- `redeven:internal/ai/activity_timeline_test.go` - screenshot references survive Floret JSON serialization and public timeline filtering.
- `redeven:internal/ai/model_gateway_deepseek_test.go` - the production adapter preserves nested tool images through the DeepSeek wire renderer.
- `redeven:desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.tsx` - Desktop Welcome media loading through authorized IPC.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopComputerStage.mjs` - opt-in built Desktop qualification through Composer, real DeepSeek, fixture completion, decoded Stage pixels, and provider image-output evidence.
- `redeven:internal/agent/agent.go` - absolute helper discovery, default managed-browser target state, and native helper fallback.
- `redeven:desktop/electron-builder.config.mjs` - packaged managed-browser helper resource.
