---
type: UI Contract
title: Workbench terminal interaction
description: Activity and Workbench consume one actor-owned semantic terminal state through view-local surfaces.
tags: [ui, terminal, workbench, activity, semantic]
timestamp: 2026-09-21T00:00:00Z
quality_exception: Cross-runtime terminal interaction contract spanning actor authority, semantic rendering, multi-view control, browser input, history, accessibility, and performance.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floeterm terminal-go v0.19.2 owns each PTY, native Ghostty VT, canonical geometry, controller epoch, semantic history, and atomic Presentation. Redeven Activity and Workbench use published terminal-web v0.19.2 to render that Presentation and complete atomic history viewports on one canvas per view and to collect view-local input. A browser view never parses PTY bytes, owns terminal history, or creates a second renderer. Authoritative live, input, resize, and renderer contract violations fail closed; auxiliary history and search failures remain local to that view and retry from a stable boundary without taking the live terminal offline.

# Contract

## One terminal owner and one view renderer
Every session has one terminal-go `SessionActor`. Its sequence and geometry generation only advance; frame width and height must equal canonical columns and rows.

The renderer fills the complete target background before cells, graphics, selection, and cursor, so resize, tab activation, and theme changes cannot expose transparent or stale edges.

## Multi-view geometry and controller ownership
All attached views receive the same authoritative Presentation.

No browser output parser or quiet timer participates in this fallback.

## Product footer placement
The [Flower Activity companion](flower-activity-companion.md#activity-terminal-footer) owns Terminal's Activity-only Flower entry placement. Terminal supplies a measured footer anchor and keeps shared-layout information at the right; Workbench never supplies that anchor. Footer layout changes do not attach a view, request controller ownership, or intercept terminal input.

## Input, links, selection, and mobile interaction
`TerminalInputBridge` sends browser-confirmed Unicode text once, sends structured key intents to terminal-go's native encoder, and gives native clipboard paste its own bounded interaction.

Script URLs, malformed URLs, stale capabilities, and remote paths fail closed.

## Clear, history, refresh, and lifecycle
User-visible clear is terminal-go's actor-owned semantic reset, not `clearRect`, Ctrl-L, session recreation, or detach. A stale generation has zero effect.

Session close/delete removes catalog authority, attachments, and capabilities and cannot be resurrected by a stale list or notification.

## Product lifecycle and performance
The catalog remains renderer-free and dormant sessions remain metadata-only. Ask Flower may capture a selection or bounded visible semantic text; it receives a working directory only through the same current local-path capability.

Real input and both post-switch view checks still run for every sample.

# Boundaries

Redeven may adapt Flowersec streams, product permissions, local-path capability, responsive placement, notifications, and Desktop URL/file actions. It must not recreate terminal parsing, key encoding, history ownership, attachment arbitration, canonical geometry, semantic frame encoding, cursor state, graphics state, or renderer internals. Local sibling dependencies, raw-byte fallbacks, hidden renderers, automatic reattach on ordinary resize, error swallowing, and sequence rollback are prohibited.

## Activity presentation
The existing canonical active/running/idle state and the persisted activity indicator preference remain authoritative. Opaque widget bodies and neutral static shadows do not change during activation, dragging, or resizing.

# Evidence

- `redeven:internal/terminal/manager.go` - Registers terminal-go live, semantic history, clear, catalog, and lifecycle boundaries.

- `redeven:internal/terminal/live_stream_test.go` - Proves permission admission and generation-scoped actor-owned clear.

- `redeven:internal/envapp/ui_src/src/ui/services/terminalTransport.ts` - Adapts one Floeterm live stream and generation-bound semantic RPC controls.
