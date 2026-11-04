---
type: UI Contract
title: Workbench terminal interaction
tags: [ui, terminal, workbench, activity, semantic]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Floeterm terminal-go owns PTY, VT, geometry, controller epoch, semantic history and atomic Presentation. terminal-web renders one canvas/view and collects local input. Authority/renderer faults fail closed; history/search faults stay local and retryable without disconnecting output.

# Contract

## Ownership
One SessionActor owns each session; sequence/geometry generation only advance. All views receive the same canonical-dimension Presentation. Paint complete background before cells/graphics/selection/cursor to prevent stale resize/activation/theme edges. Floeterm owns attachment/geometry arbitration; browser views never parse bytes, own history or hide extra renderers.

[Activity companion](flower-activity-companion.md#companion) owns its measured footer; Workbench supplies none. Layout grants no attachment/control/input authority. TerminalInputBridge sends confirmed Unicode once, structured keys to native encoder and bounded paste. Reject script/malformed URLs, stale capabilities and remote paths.

Clear is actor semantic reset, never canvas erasure/Ctrl-L/recreation/detach. Stale generations do nothing. Close/delete removes catalog/attachments/capabilities; late events cannot resurrect sessions.

## History
Published HistoryScrollbar owns capture, frame-coalesced navigation, minimum thumb, cursors, track paging and Arrow/Page/Home/End. Redeven adds a 16 CSS-pixel rail, localized name/focus style and input focus restoration. History controller alone owns offset; cancel/capture-loss/blur/disposal release dragging.

Accepted text/paste/pressed or repeated keys return live through Floeterm input-follow by default; release-only, preedit, selection/copy, modifiers/background output do not. Persisted terminal:follow_input can disable it across Activity/Workbench/container surfaces. Return clears search/errors/stale retry/trace; old replies cannot restore browsing.

Settings separate new-session Runtime defaults from explicit current-session apply. Blank uses native defaults; zero grants no history budget. Rows and bytes (MiB display) jointly constrain page-granular storage, excluding live screen; neither means character count/screen dimensions. Only admins save defaults. Current-session apply needs interaction permission and confirmation for irreversible pruning; process/live screen/canonical geometry remain.

Fence reads/confirmation to selected session. Late defaults save refreshes visible defaults after selection changes. Unknown mutation blocks changes until explicit read-only reload, never replay. Old runtimes show unavailable; all shipped locales cover labels/feedback/confirmation.

## Product state
Dormant sessions are metadata-only; catalog has no renderer. Ask Flower reads selection or bounded visible semantic text; cwd requires current local-path capability. Canonical active/running/idle state and saved activity indicators remain authoritative. Opaque bodies/neutral static shadows stay unchanged during activation/drag/resize.

# Boundaries

Redeven adapts Flowersec transport, permissions, local paths, responsive placement, notifications and Desktop URL/file actions. Never duplicate parsing/key encoding/history/arbitration/geometry/frame/cursor/graphics/rendering. No sibling links, raw-byte fallbacks, hidden renderers, resize reattach, swallowed errors or sequence rollback.

# Evidence

- `redeven:internal/terminal/manager.go` - Source.
- `redeven:internal/terminal/live_stream_test.go` - Tests.
- `redeven:internal/envapp/ui_src/scripts/checkTerminalHistoryCarrier.mjs`: real Runtime/Electron navigation/settings, 320px/200% layout, Docker Exec/restart persistence and supervised process/port cleanup.
