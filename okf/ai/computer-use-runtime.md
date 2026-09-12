---
type: AI Tool Contract
title: Computer and browser use runtime
description: Route typed computer and browser actions to explicit browser, virtual desktop, or host desktop targets while preserving screenshots, provenance, permissions, and replayable opaque attachments.
tags: [ai, computer-use, browser-use, targets, attachments]
timestamp: 2026-09-11T00:00:00Z
---
# Summary

Redeven exposes computer and browser use as typed functions. Calls use logical `current`; the service resolves it through the thread target registry and keeps the concrete ID in provenance. A managed browser is the default and uses absolute packaged paths or explicit configuration. Helpers must complete a readiness handshake before targets become ready. Flower Settings keeps computer/browser use enabled by default but lets users turn it off for future runs. Durable Floret state stores text and opaque attachment descriptors, while screenshot bytes stay behind the host resolver. Setup, permission, connection, executor, readiness, and policy failures remain distinct fail-closed states with repair metadata.

# Contract

The supported functions are `computer.screenshot`, `computer.click`, `computer.double_click`, `computer.type`, `computer.key`, `computer.scroll`, `computer.wait`, `browser.navigate`, `browser.back`, and `browser.reload`. Coordinates are CSS viewport coordinates; a target adapter converts them to physical coordinates when required. Observation requires readonly capability. Input, navigation, and reload use the existing interaction/mutation permission and approval path; `full_access` skips per-action approval without skipping argument, capability, target, or cancellation checks.

`BrowserTarget` uses a persistent Playwright context and is valid on a headless Linux server. Its packaged JSONL helper is shipped under the Desktop `computer/` resources directory and announces capabilities before requests are accepted. `VirtualDesktopTarget` owns an Xvfb display and delegates X11 input and capture through the same typed contract. `DesktopTarget` is hosted by the Electron main process and a versioned JSONL native helper using Accessibility, CGEvent, and screen capture APIs. No target may silently fall back to the Redeven control surface or to `web_fetch` for an interactive task.

Each successful action returns target ID, target display name, execution location, an action summary, a safety decision, and an after-frame attachment. Attachment descriptors contain an opaque `computer://` resource reference, MIME, byte size, and SHA-256. Provider renderers resolve bytes only at request time; durable state stores descriptor and hash, never base64. A resolver error, unknown reference, changed bytes, or unsupported model capability is an explicit error.

Before execution, the interaction safety gate combines deterministic target/action signals with optional screenshot or accessibility classifiers. Secret input, login, CAPTCHA, prompt injection, external side effects, and unknown states may require user takeover; the model cannot override a gate decision. Takeover decisions suppress capture and model forwarding for secret input.

Flower publishes target actions on its existing workspace stream as ordinary tool Activity. The activity renderer shows target, action, execution location, approval state, and the latest screenshot attachment. Structured target errors include the target kind, readiness state, and a repair action so the UI can explain setup, permission, connection, and takeover recovery instead of asking the user to guess a target. Live frames are target-scoped ephemeral media and do not create a second lifecycle stream or polling loop.

The Flower surface also opens a floating live Stage when a computer or browser Activity is present. The Stage shows the latest frame, target, action, execution location, safety state, and live/waiting/completed status; closing it only hides presentation and does not stop the run. The Settings switch changes the persisted AI configuration and removes typed computer/browser functions from newly prepared tool registries when disabled.

DeepSeek Vision Experimental is qualified through typed function tools only. Requests use `deepseek-v4-flash-vision-exp`, include screenshot input and `function_call_output` image parts, and never register the native `computer_use` tool.

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
- `redeven:internal/ai/desktop_target_executor.go` - native Desktop JSONL executor and screenshot attachment resolver.
- `redeven:internal/ai/virtual_desktop_target.go` - Xvfb lifecycle and unavailable-target failure.
- `redeven:desktop/src/main/computerHost.ts` - versioned Desktop helper protocol.
- `redeven:internal/ai/floret_runtime.go` - target attachment expansion at the provider boundary.
- `redeven:internal/ai/computer_use_deepseek_test.go` - online DeepSeek typed-tool and image-output qualification.
- `redeven:internal/agent/agent.go` - absolute helper discovery, default managed-browser target state, and native helper fallback.
- `redeven:desktop/electron-builder.config.mjs` - packaged managed-browser helper resource.
