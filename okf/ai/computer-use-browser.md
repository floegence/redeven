---
type: Browser Integration Contract
title: Managed browsers and authorized Chrome tabs
tags: [ai, browser-use, chrome, profiles]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

ComputerUseRuntime owns connection, authorization and control for managed Chromium, explicit CDP and Chrome extension through one restricted executor. Explicit Browser and desktop connection/tab creation selects the conversation target. Approval Required binds current target/URL; temporary URL authority never becomes saved origin permission.

# Contract

This is neither a model tool nor another opening path.

## Managed profiles
Both carriers use /_redeven_proxy/api/browser/installation. Default profiles lazily create their first page; later selected-page loss fails explicitly.

Under published FloeBrowser ownership, Go Runtime launches one sandboxed Chromium process group/profile; Node inventory/source adapters attach to loopback CDP. Retain Playwright isolation flags: basic profile-local credential storage/mock keychain, sandbox enabled. Never access personal keychains/request keychain permission. Passive inventory never launches Chrome. Explicit Start creates no page/target change and reuses its owner.

Explicit Stop confirms page closure with saved sign-ins/downloads retained. Gates reject Stop during action/task/private-control/viewer ownership. Retire authority before releasing gates; queued work cannot restart/replace the old page. Running/idle/stopped/failed state comes from Runtime, not profile metadata.

One maintenance worker probes once/minute; release requires ten minutes with zero actual pages, unfinished downloads and target owners. Retained pages are intentional resources. Passive reads do not reset idleness; failed probes prove nothing.

Shutdown cancels maintenance, closes owned groups independently of helper responsiveness, then escalates bounded graceful→terminate→kill. Remove receipts only after confirmed cleanup; retain/return failure, including disable/recovery. A profile kernel lock lasts for owner lifetime. Atomic receipts bind PID/birth, executable, profile and owner PID/birth. Next explicit start may reclaim a verified obsolete owner; ambiguous/live/invalid identities fail. Never scan/kill Chrome by executable name. Spawn-before-receipt and uncatchable-kill-without-restart cleanup are not guaranteed. Receipts prove cleanup identity, not authority/history/replay. Only isolated protocol fixtures may use helper launch; production stays Runtime-managed.

## Input and observation
Semantic clicks check visible/enabled/stable geometry and actual hit target, including parent overlays. Text targets require the fixed point inside the exact source text quad and the actual hit on its containing element, including Shadow DOM/frame coordinates; no parent action or alternate point is substituted. Preparation is not input completion: blocked clicks return action_executed:false and fresh-observation demand after viewport change. Bounded waits sample rendered CSS; labels use safe observed titles, never discovery as account identity.

Same-document capture may settle read-only for <=1s within budget; check before/after capture. Persistent motion returns capture/viewport_unstable without pixels. Cancellation/document change/privacy latch wins; never replay input. Frame inventory owns document identity: child navigation/removal revokes its subtree; root replacement/cancel/handback revokes all. Image/snapshot revisions stay page-wide; ref reads recheck document after DOM/AX.

Locator keys require focusable elements; AX roots use ui.key('PageDown'). Exact DOM.focus/document rejection yields ELEMENT_NOT_ACTIONABLE, focus/not_focusable, no key/connection retirement. Generic faults/lost focus/unknown acknowledgements or release stay uncertain without replay; retain safe stage/reason/fresh-read demand, warning and completed prefix.

Hit tests convert viewport CSS into owning CDP document coordinates, including scrolled frames, and check every cross-process embedding overlay. Unavailable protocol yields TARGET_OBSERVATION_UNAVAILABLE/observation_stage:hit_test, never invented coverage. Capture includes non-overlay scrollbars and an immutable actual-dimension transform with before/after checks. Scoped scroll verifies its control-center hit target.

## Downloads
Capture browser.downloadCursor() before input; sequential waitForDownload({after:cursor}) or exact known ID follows. Bounded page-local memory excludes old files; multiple arrivals are ambiguous. No replay/latest-file inference/durable ledger. Published SourceDownload alone writes identity; raw CDP cannot duplicate it. Same names remain distinct; AMBIGUOUS_DOWNLOAD includes bounded exact candidates.

readDownload(id,{offset,limit}) returns bounded base64/continuation; sequential chunks share a short-lived stream retired on cancel/idle/disposal. saveDownload(id) copies <=256MiB into task scratch with run authorization/partial cleanup and per-chunk offset/count/identity/total validation. Guests cannot choose paths; terminal/file tools process the returned path and deliver finals.

## Chrome extension and CDP
MV3 uses Native Messaging/chrome.debugger for the exact tab. Bounded webNavigation creation facts identify popup source; tab-group opener metadata is not action provenance. Remote Linux uses remote managed browser/private desktop, never silent local Chrome.

# Boundaries

Internal cancellation drains the operation before clearing its ephemeral flag; it never sets user_control or changes private mode/permission/Stop barriers. Drained reads permit authorized same-target reads; uncertain writes remain terminal. Invalidated captures without bytes/attachments retain observation_invalidated/needs_observation; inconsistent target/safety/frame payloads fail.

Recovery uses ordinary profile preparation; private input cannot own another default profile and passive sampling launches nothing. [Design evidence](computer-use-design-evidence.md) records public/installed-code comparisons; no forced reload/CSP rewriting. Pre-identity failure cannot bind guessed downloads. Generic unavailable events neither latch globally nor infer names/times; waits may time out until identity-bearing upstream failure exists.

# Evidence

- redeven:internal/ai/computer_managed_browser.go; computer_browser_process_unix.go; computer_browser_management.go.
- November 2, 2026, macOS arm64/catalog Chromium 153.0.8010.12: 100 start/reuse/page/stop cycles reap every group. Real checks cover helper kill/hang, owner SIGKILL then explicit restart, empty idle release, retained pages, active-task denial, independent browser, sandbox flags and popup viewport. Initial missing keychain flags stopped that run; cleanup/isolation repair preceded requalification. Linux and uncatchable-kill-without-restart remain unqualified.
- 77 shared UI assertions include 390/1280px lifecycle/failed-stop retention; 71 localization/copy checks cover both carriers. API checks reject absent authority, unknown fields/actions and foreign paths.
- redeven:internal/ai/computer_managed_browser_test.go; redeven:internal/ai/computer_extension.go.
