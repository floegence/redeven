---
type: UI Contract
title: Workbench terminal interaction
description: Terminal attachment, input-plane ownership, focus, retained history, and performance validation.
tags: [ui, workbench, terminal, performance]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Workbench Terminal separates Runtime attachment, retained history, input-plane ownership, native focus, and fixed performance validation. Only the matching coordinator generation may complete attachment, and published Floeterm remains the authority for terminal input behavior. Mobile keyboard retention does not imply textarea autofocus, while performance evidence remains a dedicated Chromium and carrier contract rather than an ordinary CI timing claim.

# Contract

## Mechanism



# Boundaries

Terminal initial attachment is two-phase: live retention begins before the Runtime request, and only the matching coordinator generation may complete with the Runtime's atomic history boundary. Env App also assigns a separate monotonic attachment generation owned by the underlying protocol transport, so Activity and Workbench RPC facades share one order while the stream is shared. Runtime rejects stale generations before boundary capture, preserves failed-generation high-water until sink or session teardown, and cannot revive a closed sink or let stale activation rollback remove a newer attachment. A superseded interactive surface retries only while it still owns the view, active session, and focus intent; a background surface waits until it regains ownership, preventing both blank current terminals and cross-surface attach loops. Missing or malformed boundaries fail closed; a valid zero boundary completes without an unbounded history request. This contract applies equally to Activity and Workbench terminals and does not create a Redeven-owned recovery queue. Before the first Terminal surface is interactive, the Env catalog may idle-preload the Terminal feature chunk and published renderer resources. The Activity Terminal page does not mount `TerminalPanel` before the first successful catalog hydration. A short disconnect may mark an already hydrated snapshot stale and keep it mounted, but an initial refresh failure cannot use `stale` as a substitute for a snapshot. Explicit process-launch denial mounts the panel permission state instead of leaving the page gated. A server-side process denial is retained against the matching environment, protocol client, and permission snapshot so an automatic retry cannot hide the permission state; a new permission snapshot or client identity clears that fence and retries hydration. A catalog wait remains visually quiet for 150 ms, then shows a loading curtain; a catalog error shows a retry action. After an interactive Runtime is ready, an Env-scoped queue may prepare renderer-neutral history only for `isActive` sessions, one page and one session at a time, under a byte-bounded MRU cache. Each preparation is capped by the candidate's actual remaining-or-evictable byte budget, and a budget stop cannot cancel a more recent background candidate or any interactive request. A zero-byte incomplete seed is not cached because it cannot reduce interactive recovery work, while a complete empty-history seed remains valid. Prepared seeds are consumed through Floeterm's generation/retention validation; a mismatch falls back to normal paged recovery. If an unrelated background history RPC cannot be cancelled promptly, an interactive request abandons its seed attempt and uses normal recovery instead of waiting behind background work. Dormant sessions remain metadata-only: background work never creates a Core, attaches, resizes, subscribes to live output, or starts a PTY. Disconnect, page hiding, clear, delete, environment changes, and permission loss cancel or invalidate warmup without allowing late results to repopulate a newer connection epoch.

Terminal input-plane ownership is upstream-only. Redeven consumes the released Floeterm behavior and verifies it through a real Chromium Workbench flow with the actual `TerminalCore`, fit geometry, a preserved selected widget at 45% viewport scale, and Ghostty's canvas click path. The regression gate requires the textarea to stay in the document viewport plane, align with the visible cursor cell, leave render-host extents equal to client extents, preserve zero host scroll before and after focus, and keep canvas offsets and intrinsic/client dimensions unchanged. Context-menu transient placement, IME composition, and terminal-local shortcut ownership remain Floeterm contracts rather than Redeven compatibility branches.

Terminal attachment ownership is deliberately separate from native textarea autofocus. This lets a Floe mobile-keyboard surface retain and retry the real Runtime attachment without opening the system IME. Surface disposal invalidates reload work at asynchronous boundaries and queued retries, so a removed Activity or Workbench panel cannot perform a ghost attach or reclaim attachment ownership later.

Fixed-spec Terminal performance validation is separate from ordinary CI timing. Browser interaction samples calculate nearest-rank p95 for the preloaded Activity intent-to-real-sidebar path, hydrated sidebar presentation, pending-row paint, and warm-core switching. The Runtime/PTY carrier aggregates repeated 64 KiB shared prepared-history samples, uses a unique input marker and same-sample Activity canvas baseline for every run, and enforces both per-sample and p95 recovery limits. Equal terminal geometries use the strict normalized-grid comparison; different Activity and Workbench geometries combine generation, coverage, delta, and attach invariants with nonblank coarse canvas evidence instead of treating valid reflow as content loss. The unified report includes raw samples, a recomputed p95, tracked and untracked source revision state, runner identity, and carrier evidence. Absolute thresholds are enabled only by the fixed-performance runner; ordinary hosted CI retains deterministic frame, call-count, bundle-graph, coverage, and no-error gates.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:92` - Terminal shortcut bounds are local to the first nine visible sessions.
- `redeven:internal/envapp/ui_src/package.json:24` - Env App consumes the published Floeterm terminal-web coordinator release.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx:666` - Every mounted Activity or Workbench terminal uses the paged output coordinator.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionNavigator.tsx:96` - Terminal sessions render in one desktop-sidebar/mobile-drawer component rather than the top tab strip.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.test.tsx:2661` - Tests cover creating a terminal without centering when ensureVisible is false.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.test.tsx:243` - Tests keep projected layer scroll anchoring separate from terminal focus behavior.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2116` - Terminal widget removal schedules Workbench-scoped session cleanup without awaiting it.
- `redeven:internal/envapp/ui_src/src/ui/services/workbenchLayoutApi.ts:180` - The UI calls the bulk terminal widget session cleanup endpoint through a Workbench API wrapper.
- `redeven:internal/codeapp/appserver/workbench_layout_api.go:167` - The server clears terminal widget state and requests session deletion through owner-scoped terminal lifecycle.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:72` - Terminal widget state and activation are forwarded into the lazy Terminal body.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.test.tsx:177` - Tests await lazy resolution before asserting terminal state and activation contracts.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalAdaptiveWorkingSet.ts:1` - Adaptive warm-core policy protects active interactions and stores only bounded in-memory snapshots.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.browser.test.tsx:843` - Browser coverage keeps switching responsive while an inactive session receives heavy output.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvTerminalPage.tsx:18` - Activity Terminal waits for successful hydration, or explicit permission denial, before mounting the panel.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalHistoryWarmup.ts:228` - Prepared history is capped by the candidate's actual available warmup budget.
- `redeven:internal/envapp/ui_src/scripts/checkTerminalRecoveryCarrier.mjs:902` - The real Runtime/PTY carrier calculates and gates repeated shared prepared-history p95.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalSessionCatalog.tsx:367` - Server-side permission denial is scoped to the environment, client, and permission snapshot before retry.
- `redeven:internal/envapp/ui_src/scripts/terminalCarrierThreshold.mjs:71` - Carrier visual evidence distinguishes strict same-layout comparison from cross-layout coarse rendering proof.
- `redeven:internal/envapp/ui_src/scripts/checkTerminalInteractionPerformance.mjs:78` - Fixed-performance source revision evidence includes non-ignored untracked files.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalWorkbenchInputPlane.browser.test.tsx:48` - Chromium coverage verifies the portaled textarea, visible cursor anchor, zero render-host scrolling, and stable canvas geometry through fit, 45% scaling, and focus.
- `redeven:scripts/check_flower_ui.sh:76` - The Flower UI quality gate runs the Workbench terminal input-plane Chromium regression.
