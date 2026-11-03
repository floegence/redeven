---
type: UI Contract
title: Workbench terminal interaction
tags: [ui, terminal, workbench, activity, semantic]
quality_exception: Cross-runtime terminal interaction contract spanning actor authority, semantic rendering, multi-view control, browser input, history, accessibility, and performance.
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Floeterm terminal-go owns PTY, native VT, geometry, controller epoch, semantic history and atomic Presentation. Released terminal-web renders one canvas per view and collects local input. Authority/renderer violations fail closed; auxiliary history or search errors stay local and retryable without disconnecting live output.

# Contract

## One terminal owner and one view renderer
One `SessionActor` owns each session; sequence and geometry generation only advance. Every view receives the same authoritative Presentation with canonical dimensions. Paint complete backgrounds before cells, graphics, selection and cursor to avoid stale edges during resize, activation or theme changes.

## Multi-view geometry and controller ownership
Published Floeterm owns attachment arbitration and geometry. Browser views never parse output bytes, own history or create hidden renderers.

## Product footer placement
[Activity companion](flower-activity-companion.md#activity-terminal-footer) owns the Activity-only measured footer entry. Workbench supplies none. Layout cannot attach a view, request control or intercept terminal input.

## Input, links, selection, and mobile interaction
`TerminalInputBridge` sends confirmed Unicode once, structured key intents to the native encoder and clipboard paste through its bounded interaction. Script/malformed URLs, stale capabilities and remote paths fail closed.

## Clear, history, refresh, and lifecycle
Clear is the actor's semantic reset, never canvas erasure, Ctrl-L, recreation or detach; stale generations have no effect. Close/delete removes catalog, attachments and capabilities; stale notifications cannot resurrect sessions.

## History navigation and retention controls
Floeterm's published `HistoryScrollbar` owns drag capture, frame-coalesced pointer navigation, minimum thumb size, cursors, track paging and Arrow/Page/Home/End keyboard behavior. Redeven supplies a 16 CSS-pixel rail, localized accessible name, focus styling and input-focus restoration after pointer navigation. The history controller remains the sole offset owner. Pointer cancellation, capture loss, blur and disposal release drag state.

Accepted text, paste and pressed/repeated key intents return to live by default through Floeterm's input-follow method. Release-only intents, composition preedit, selection/copy, modifiers and background output do not. The persisted local `terminal:follow_input` preference can disable this behavior. Returning to live clears product search, errors and stale retry/trace state; old history responses cannot restore browsing. Activity, Workbench and container terminal surfaces consume the same preference.

Settings distinguish Runtime defaults for new sessions from explicit application to the attached current session. Blank fields select native defaults; zero retains no historical budget. Rows and memory bytes (displayed as MiB) constrain native storage together, exclude the live screen and are page-granular. These are not character counts or fixed screen dimensions. Only administrators save Runtime defaults. Current-session changes require terminal interaction permission and explicit confirmation because pruning is irreversible. The process, live screen and canonical geometry remain intact.

The dialog fences reads and confirmation to the selected session; a defaults save that settles after switching sessions refreshes the visible defaults. Unknown mutation outcomes disable further changes until an explicit read-only reload; it never replays an uncertain mutation. Old runtimes expose an unavailable state. All labels, feedback and confirmations have complete shipped-locale translations.

## Product lifecycle and performance
Dormant sessions remain metadata-only and the catalog renderer-free. Ask Flower captures selection or bounded visible semantic text; working directory requires current local-path capability.

# Boundaries

Redeven may adapt Flowersec streams, product permissions, local-path capability, responsive placement, notifications, and Desktop URL/file actions. It must not recreate terminal parsing, key encoding, history ownership, attachment arbitration, canonical geometry, semantic frame encoding, cursor state, graphics state, or renderer internals. Local sibling dependencies, raw-byte fallbacks, hidden renderers, automatic reattach on ordinary resize, error swallowing, and sequence rollback are prohibited.

## Activity presentation
The existing canonical active/running/idle state and the persisted activity indicator preference remain authoritative. Opaque widget bodies and neutral static shadows do not change during activation, dragging, or resizing.

# Evidence

- `redeven:internal/terminal/manager.go` - Published terminal live/history/clear/catalog/lifecycle RPC.

- `redeven:internal/terminal/live_stream_test.go` - Permission and generation-bound actor clear.

- `redeven:internal/envapp/ui_src/scripts/checkTerminalHistoryCarrier.mjs` - Real Runtime and Electron navigation, settings, 320px/200% layout, Docker Exec, restart persistence and supervised process/port cleanup.
