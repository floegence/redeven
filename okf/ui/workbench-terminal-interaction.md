---
type: UI Contract
title: Workbench terminal interaction
tags: [ui, terminal, workbench, activity, semantic]
quality_exception: Cross-runtime terminal interaction contract spanning actor authority, semantic rendering, multi-view control, browser input, history, accessibility, and performance.
lifecycle: contract
reviewed_at: "2026-10-25"
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

## Product lifecycle and performance
Dormant sessions remain metadata-only and the catalog renderer-free. Ask Flower captures selection or bounded visible semantic text; working directory requires current local-path capability.

# Boundaries

Redeven may adapt Flowersec streams, product permissions, local-path capability, responsive placement, notifications, and Desktop URL/file actions. It must not recreate terminal parsing, key encoding, history ownership, attachment arbitration, canonical geometry, semantic frame encoding, cursor state, graphics state, or renderer internals. Local sibling dependencies, raw-byte fallbacks, hidden renderers, automatic reattach on ordinary resize, error swallowing, and sequence rollback are prohibited.

## Activity presentation
The existing canonical active/running/idle state and the persisted activity indicator preference remain authoritative. Opaque widget bodies and neutral static shadows do not change during activation, dragging, or resizing.

# Evidence

- `redeven:internal/terminal/manager.go` - Registers terminal-go live, semantic history, clear, catalog, and lifecycle boundaries.

- `redeven:internal/terminal/live_stream_test.go` - Proves permission admission and generation-scoped actor-owned clear.
