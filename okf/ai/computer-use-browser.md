---
type: Browser Integration Contract
title: Managed browsers and authorized Chrome tabs
tags: [ai, browser-use, chrome, profiles]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

ComputerUseRuntime owns connections/authorization/control. Managed Chromium, explicit CDP and Chrome extension share one restricted executor. Selected-tab authority excludes siblings/other devices. Disconnect/revocation/closed tabs/uncertain effects stop work without automatic replacement.

# Contract

Explicit connection/tab creation in Browser and desktop selects the conversation target. Approval Required uses current target/URL through approval; temporary URL authority never becomes saved origin permission. This is not a model tool/second browser-opening path.

## Managed profiles

Both Flower carriers share /_redeven_proxy/api/browser/installation. Default profile lazily creates its first page; later selected-page loss fails explicitly.

The embedding host owns browser/profile lifecycle, as required by the published FloeBrowser boundary. Redeven's Go Runtime directly starts one sandboxed Chromium process group per active profile; the Node inventory helper and source adapters attach to its loopback CDP endpoint. The launcher preserves the prior Playwright managed-profile isolation flags: basic profile-local credential storage and mock keychain, with the Chromium sandbox enabled. It must not access personal OS keychains or request keychain permission. Passive profile/tab inventory never launches Chrome. Explicit Start creates no page and never changes the conversation target. Repeated Start reuses its owner.

Stop is explicit and confirms that pages close while saved sign-ins and downloads remain. Target gates reject Stop while an action, task, private-control reservation or viewer owns a target. Retirement closes execution authority before releasing those gates; queued work cannot restart or silently replace the old page. Both carriers show running/idle/stopped/failed profile state from the Runtime, never persisted in profile metadata.

One Runtime maintenance worker checks once per minute. A profile must have zero actual page targets, zero unfinished downloads and no target owner for ten minutes before release. Retained pages are intentional resources, regardless of action inactivity. Passive queries do not reset this timer. A bounded probe failure cannot certify idleness.

Shutdown cancels maintenance and closes owned browser groups independently of helper responsiveness. Graceful shutdown escalates to group termination, then group kill with bounded waits; confirmed cleanup removes the profile receipt. Failed cleanup is retained and returned, including disable/recovery paths. A profile-scoped kernel lock lasts for its owner lifetime. Atomic receipts bind PID/birth time, executable, profile and owner PID/birth time. On the next explicit profile start after an owner crash, reclaim only a verified obsolete owner. Ambiguous identity, live ownership or invalid receipts fail closed. Never scan/kill unrelated Chrome by executable name.

Recovery cannot guarantee cleanup in the brief spawn-before-receipt window or after an uncatchable host kill without a later profile start. The receipt is process cleanup evidence, never authorization, task history or an effect replay log. Standalone protocol fixtures retain their isolated helper launch path; production executors are Runtime-managed and cannot enter it.


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

- redeven:internal/ai/computer_managed_browser.go and computer_browser_process_unix.go own profiles/process groups; computer_browser_management.go owns explicit and idle release.
- November 2, 2026, macOS arm64: catalog Chromium 153.0.8010.12 passes 100 start/reuse/create-page/stop cycles with every owned group reaped. Real tests cover helper kill/hang, owner SIGKILL followed by explicit restart, empty-profile idle release, retained pages, active-task rejection, independent-browser preservation, sandbox flags and initial popup viewport. The first draft omitted Playwright's keychain flags; that run was stopped, owned processes reaped, isolation restored and qualification repeated. Linux runtime and uncatchable-kill-without-restart cleanup remain unqualified.
- Shared UI browser tests pass 77 assertions, including 390/1280-width profile lifecycle and failed-stop state retention; 71 localization/copy assertions cover both carriers. API tests reject missing authority, unknown fields/actions and foreign profile paths.
- redeven:internal/ai/computer_managed_browser_test.go covers login isolation/downloads/validation.
- redeven:internal/ai/computer_extension.go covers authorization/framing/cancellation.
