---
type: Browser Integration Contract
title: Managed browsers and authorized Chrome tabs
tags: [ai, browser-use, chrome, profiles]
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

ComputerUseRuntime owns connections/authorization/control. Managed Chromium, explicit CDP and Chrome extension share one restricted executor. Selected-tab authority excludes siblings/other devices. Disconnect/revocation/closed tabs/uncertain effects stop work without automatic replacement.

# Contract

Explicit connection/tab creation in Browser and desktop selects the conversation target. Approval Required uses current target/URL through approval; temporary URL authority never becomes saved origin permission. This is not a model tool/second browser-opening path.

## Managed profiles

Both Flower carriers share /_redeven_proxy/api/browser/installation. Default profile lazily creates its first page; later selected-page loss fails explicitly.

Semantic clicks verify visible/enabled/stable geometry and actual session hit target, including parent overlays. Preparation is not completed input: blocked clicks report action_executed:false and fresh-observation demand after viewport changes. Bounded condition waits sample rendered CSS state. Labels use current safe observed titles, not discovery as account identity.

Same-document screenshot geometry may settle read-only for at most1s within invocation budget; check before/after every capture. Persistent movement returns capture/viewport_unstable without pixels. Cancellation/document changes/latched privacy guard remain authoritative. Never replay input to repair observation.

Frame inventory owns document identity. Child navigation/removal revokes its subtree, preserving unchanged parent refs. Root replacement/cancel/handback invalidates all. Snapshot/image revisions stay page-wide; ref resolution rechecks document after DOM/AX reads.

Locator keys require focusable elements; AX document roots use ui.key('PageDown'). Exact DOM.focus/document rejection returns ELEMENT_NOT_ACTIONABLE with focus/not_focusable, no key/connection retirement. Generic failures/lost focus or input acknowledgment/failed release remain uncertain, without replay. Expose safe stage/reason/fresh-observation demand plus warning and completed prefix.

Downloads use browser.downloadCursor() before input, sequential waitForDownload({after:cursor}), or exact known ID. Bounded page-local memory excludes old files; multiple new files are ambiguous. No replay/latest-file inference/durable ledger. Published SourceDownload is sole identity writer; raw CDP creates no duplicates. Same-named exports stay distinct; AMBIGUOUS_DOWNLOAD exposes bounded exact candidates.

readDownload(id,{offset,limit}) returns bounded base64/continuation from exact source; sequential chunks share a short-lived stream retired on cancel/idle/disposal. saveDownload(id) copies at most256MiB into task scratch with run-owned authorization/partial cleanup, validating offset/count/identity/available total each chunk. Guest cannot select destination/arbitrary paths; terminal/file tools process returned path and deliver finals.

Hit tests convert viewport CSS to owning CDP document coordinates, including scrolled frames. Cross-process input checks all embedding overlays. Protocol unavailability reports TARGET_OBSERVATION_UNAVAILABLE/observation_stage:hit_test, never fabricated coverage. Capture includes non-overlay scrollbars and derives immutable transform from actual dimensions with before/after stability. Scoped scroll verifies control-center hit target first.

## Chrome extension and explicit CDP

MV3 uses Native Messaging/chrome.debugger bound to exact tab. webNavigation creation events keep bounded popup-source facts; tab-group opener metadata is not action source. Remote Linux tasks use remote managed browser/private desktop, never silently local Chrome.

# Boundaries

Internal cancellation drains active operation before clearing its ephemeral flag, without setting user_control/changing private mode/clearing permission or Stop barriers. Drained reads return observation failure and permit authorized same-target reads; uncertain writes remain terminal/no replay. Invalidated screenshots without bytes/attachments retain observation_invalidated/needs_observation; inconsistent target/safety/frame payloads fail.

Restart recovery shares ordinary managed-profile preparation; private input cannot own a second default profile, and passive sampling never launches resources. [Design evidence](computer-use-design-evidence.md) covers public/installed-code comparison; no forced reload/CSP rewriting.

Pre-identity capture failures cannot bind guessed downloads. Generic unavailable events neither latch globally nor infer filename/time; waits may time out until upstream supplies identity-bearing failure.

# Evidence

- redeven:internal/ai/computer_managed_browser.go owns profiles/processes.
- redeven:internal/ai/computer_managed_browser_test.go covers login isolation/downloads/validation.
- redeven:internal/ai/computer_extension.go covers authorization/framing/cancellation.
