---
type: Browser Integration Contract
title: Managed browsers and authorized Chrome tabs
description: Bind an explicit profile and tab to the Runtime while preserving login state and unrelated user browsing.
tags: [ai, browser-use, chrome, profiles]
timestamp: 2026-09-26T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

`ComputerUseRuntime` owns browser connections, authorization and target control.
Managed Chromium, explicit CDP and Chrome extension bindings share the same
restricted page executor. A selected tab never implies authority over sibling
tabs or a different device. Disconnect, revocation, closed tabs and uncertain
effects stop subsequent work without automatically selecting a replacement.

# Contract

Connecting an explicitly chosen tab or creating a new tab in Browser and desktop also selects that target for the current conversation. Approval Required uses the current target and URL through tool approval; temporary URL authorization never becomes a saved origin grant.

It is not a model tool or a second browser-opening path.

## Managed profiles
Both Flower carriers use the shared browser installation controller at `/_redeven_proxy/api/browser/installation`.

The default profile creates its first page lazily; later loss of a selected page fails explicitly.

Semantic clicks check visible/enabled state, stable bounds and the actual input-session hit target before input, including parent-frame overlays. Preparatory scrolling is not a completed click; a blocked click reports `action_executed:false` and requires fresh observation when preparation changed the viewport. Condition waits inspect rendered state and use bounded sampling for CSS changes. Browser result labels use the current safe observation title when available; they do not treat a discovery label as current account identity.

Locator key presses require a focusable DOM element. AX document roots are not elements; use `ui.key('PageDown')` for page-level keys. Document validation and exact confirmed DOM.focus rejections return ELEMENT_NOT_ACTIONABLE with focus/not_focusable diagnostics, without dispatching a key or retiring the connection. Generic command failures, lost focus/input acknowledgements and failed key release remain uncertain; no action is replayed. Returned uncertainty retains a safe stage/reason, requests fresh observation, and keeps both the warning and completed-prefix facts in model-visible output.

Download association uses `browser.downloadCursor()` before the triggering input, followed sequentially by `browser.waitForDownload({after:cursor})`; an exact known `id` is also accepted. A cursor is bounded in-memory state owned by the page. Old files never satisfy it and multiple new files fail as ambiguous. No automatic input replay, latest-file inference or durable download ledger exists.

The guest cannot choose filesystem destinations or read file bytes; a later authorized file/command tool handles data processing.

Hit tests translate viewport CSS points into the owning CDP session document
coordinates, including scrolled frames. Cross-process frame input checks every
embedding document for overlays. An unavailable protocol hit test returns
`TARGET_OBSERVATION_UNAVAILABLE` with `observation_stage:hit_test`, without
claiming the element is covered. Screenshot capture uses the native viewport
including non-overlay scrollbars and derives the immutable image transform from
captured dimensions. Geometry must remain stable before/after capture. Scoped
scroll uses the control center and verifies its hit target before dispatch.

## Chrome extension and explicit CDP
The MV3 extension uses Native Messaging and `chrome.debugger` bound to an exact tab.

Its webNavigation creation events retain bounded, in-memory popup source facts; Chrome tab-group opener metadata is not treated as the source of an action.

A remote Linux task uses its remote managed browser or private desktop; it cannot silently drive local user Chrome.

# Boundaries

Internal source cancellation drains the active operation before clearing its
ephemeral cancellation flag. It never sets user_control, changes private mode,
or clears permission/Stop barriers. Drained cancelled reads return observation
failure and permit later authorized same-target reads; uncertain mutations stay
terminal without replay. Routine invalidated screenshots with no bytes or
attachments retain observation_invalidated and needs_observation. Inconsistent
target, safety or frame payloads still fail.

Private control recovery after Runtime restart uses the same initial managed profile preparation as ordinary tools. The private input helper cannot create a second owner of the default profile; passive sampling never launches resources.

See the [Codex design evidence](computer-use-design-evidence.md) for the public and installed-code comparison; no forced reload or CSP rewriting is used.

# Evidence

- `redeven:internal/ai/computer_managed_browser.go` - managed profile and process ownership.

- `redeven:internal/ai/computer_managed_browser_test.go` - login isolation, saved downloads and profile validation.

- `redeven:internal/ai/computer_extension.go` - connection authorization, framing and scoped cancellation.
