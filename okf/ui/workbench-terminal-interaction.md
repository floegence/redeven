---
type: UI Contract
title: Workbench terminal interaction
description: Activity and Workbench consume one actor-owned semantic terminal state through view-local surfaces.
tags: [ui, terminal, workbench, activity, semantic]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Floeterm terminal-go v0.10.4 owns each PTY, native Ghostty VT, canonical geometry, controller epoch, semantic history, and atomic Presentation. Redeven Activity and Workbench use published terminal-web v0.15.5 to render that Presentation on one canvas per view and to collect view-local input. A browser view never parses PTY bytes, owns terminal history, or creates a second renderer. Contract violations fail closed; reconnect is reserved for an observable transport loss and is not normal resize control flow.

# Contract

## One terminal owner and one view renderer

Every session has one terminal-go `SessionActor`. PTY output, structured input, resize, history queries, and semantic clear enter that actor in sequence. A Presentation atomically contains state, geometry, and one complete semantic frame. Its sequence and geometry generation only advance; frame width and height must equal canonical columns and rows.

Every mounted Activity or Workbench runtime opens its own `terminal/live_v1` attachment and mounts exactly one `RendererSurface` canvas plus one `TerminalInputBridge` textarea. The canvas consumes complete Presentations and is the only visible renderer. The textarea owns keyboard, paste, and composition events but does not draw or parse output. TerminalCore, Ghostty WebAssembly, checkpoint workers, Beamterm, raw replay, browser journals, and hidden compatibility canvases are absent from source and packaged dependency graphs.

The canvas CSS box follows its host content box immediately. Its backing store follows CSS pixels times device-pixel ratio without replacing the canvas. Palette, font, DPR, and bounds changes repaint the latest immutable Presentation; they do not change the PTY, sequence, or geometry by themselves. A hidden keep-mounted canvas remains hidden while its host is zero-sized and is exposed only after an atomic render commit matches the newly visible host and DPR; the browser never stretches an old small bitmap across the active pane. The renderer fills the complete target background before cells, graphics, selection, and cursor, so resize, tab activation, and theme changes cannot expose transparent or stale edges.

## Multi-view geometry and controller ownership

All attached views receive the same authoritative Presentation. A view may crop or pad locally, project semantic history, select text, search, and use its own palette without changing the PTY. Only the current controller view may send input or propose canonical geometry. The proposed grid is measured from the terminal host's untransformed layout content box, so a Workbench projection transform cannot shrink canonical columns or rows. Selecting or directly interacting with another authorized view sends one explicit activation containing that grid and the current controller epoch. terminal-go atomically transfers ownership, applies the new grid, and captures the matching Presentation before focus or input can commit; the old controller becomes an observer without a prompt, popup, duplicate write, or focus theft. The outer Activity/Workbench display mode and the selected Workbench widget jointly gate activation: a keep-mounted Activity peer remains attached for shared presentation but cannot reclaim control while Workbench is selected. Ordinary observer ResizeObserver updates never claim control. Old transport generations, stale controller epochs, and cross-principal requests have zero effect and preserve their exact fail-closed reason.

Resize settles only when terminal-go has applied the canonical geometry and emitted the matching new Presentation. Redeven never acknowledges resize with an old frame, broadcasts a stored frame as a resize result, or treats attachment loss as success. Rapid grow and shrink is latest-wins only before presentation; once visible, sequence and geometry cannot regress. Activity and Workbench may have different host bounds, but every view renders the same frame dimensions and sequence.

## Input, links, selection, and mobile interaction

`TerminalInputBridge` sends browser-confirmed Unicode text once and sends structured key intents to terminal-go's native encoder. Composition preedit, key code 229, and composing key events do not reach the PTY. Composition commit, paste, ordinary text, Enter, Tab, Backspace, arrows, modifiers, emoji, and combining text preserve exact-once behavior. Observer views are read-only. The editable textarea stays positioned at the semantic cursor in CSS coordinates so the operating system IME candidate window follows the visible caret; DPR affects backing pixels only.

Selection belongs to `RendererSurface`. A same-cell pointer down/up is an ordinary focus click and leaves no selection paint or copy text; movement past the drag threshold may select one cell or a larger range. Copy reads that selection and uses the product clipboard path; Ctrl+C without a selection remains terminal input. Search reads bounded semantic history pages and projects an owned semantic page without changing the authoritative Presentation sequence. Touch gestures use the same view-local history projection on the normal screen and terminal input on the alternate screen. Mobile keyboard policy may choose system or Floe input, but neither path creates another VT owner.

OSC8 cells retain their explicit hyperlink. Cmd/Ctrl-click accepts only `http` or `https` URLs and routes the user action through the Desktop external-URL boundary when available. Lexical file links are resolved from the displayed semantic row and require the current Redeven local-path capability before preview. Ordinary click remains terminal focus/input. Script URLs, malformed URLs, stale capabilities, and remote paths fail closed.

## Clear, history, refresh, and lifecycle

User-visible clear is terminal-go's actor-owned semantic reset, not `clearRect`, Ctrl-L, session recreation, or detach. The request is bound to the current connection, transport generation, attachment, and permission. Success advances content epoch and Presentation sequence and all views converge on the cleared frame. A stale generation has zero effect.

Semantic history is the native VT's only history authority. Queries return temporary owned pages with bounded rows and explicit revision, anchor, availability, offset, and frame. The client binds each request and response to its current connection generation; a stale response is discarded. View-local history scroll or search never changes PTY geometry or the live Presentation sequence.

Refresh forgets only the current view's live attachment and attaches again. terminal-go immediately emits a current Presentation even when geometry is unchanged, so a quiet shell redraws without synthetic PTY output. The existing semantic canvas remains mounted. Transport loss follows a finite observable retry state; permission denial, protocol failure, actor failure, or invalid semantic data remains an exact fail-closed error. Session close/delete removes catalog authority, attachments, and capabilities and cannot be resurrected by a stale list or notification.

## Capability evidence map

The following coordinates preserve user-facing behavior after removal of legacy implementation-coupled tests:

- Selection and copy: `TerminalSessionRuntime.semantic.browser.test.tsx` selects renderer text, copies it, and keeps Ctrl+C as native input when no selection exists.
- Paste and IME: the same browser test covers Unicode paste, composition preedit suppression, exact-once commit, and observer denial; Floeterm's published semantic tests own candidate anchoring and CJK/emoji glyph metrics.
- Search and history scroll/crop: the semantic browser test scans actor-owned pages, projects the matching owned page, and proves view-local touch/history does not advance Presentation.
- OSC8 and file links: `TerminalPanel.semantic.test.ts` covers safe URL protocols, exact cell hit-testing, and capability-resolved file targets; `terminalLinkProvider.test.ts` covers lexical path admission.
- Clear: `internal/terminal/live_stream_test.go`, `terminalTransport.test.ts`, `TerminalPanel.semantic.test.ts`, and `checkSemanticTerminalCarrier.mjs` cover stale-generation denial through real multi-view repaint.
- Refresh and reconnect: `refresh_redraw_integration_test.go`, `terminalTransport.test.ts`, and the semantic carrier prove quiet same-size redraw, explicit lifecycle, and stable canvas identity.
- Permission and lifecycle cleanup: `internal/terminal/live_stream_test.go`, `manager_test.go`, and `terminalSessionCatalog.test.tsx` cover process denial, hidden cleanup failure, deletion, and stale catalog rejection.
- Activity, Workbench, controller, and observer: the semantic browser test covers explicit activation-before-focus/input, ordered input settlement, rejection without PTY writes, transformed-host measurement, read-only observers, and controller diagnostics; the semantic carrier opens both surfaces, proves the hidden display mode cannot reclaim control, and requires identical sequence, epoch, and frame geometry.
- Theme, cursor, resize, CJK, and graphics: the semantic browser test covers view-local palette, typography, atomic Presentation, monotonic resize, one canvas, and fifty three-tab zero-size-to-visible commits across DPR 1/1.5/2; published terminal-web tests cover cursor shapes, IME anchor, natural grapheme width, DPR repaint, and Kitty graphics; the carrier covers real top alternate-screen resize, fifty three-session paint-safe switches, and nontransparent pixels.
- Touch and mobile input: `mobileViewportPolicy.test.ts`, the semantic browser touch projection test, and TerminalPanel's input-mode contract preserve system and Floe keyboard paths without textarea autofocus.

## Product lifecycle and performance

The catalog remains renderer-free and dormant sessions remain metadata-only. Terminal chrome derives from catalog snapshots for foreground command, output activity, execution context, semantic work, and local-path capability. Those facts are display metadata, not filesystem authority. Ask Flower may capture a selection or bounded visible semantic text; it receives a working directory only through the same current local-path capability.

The exact-main performance gate measures twenty semantic Presentation paints, input dispatches, and resize settlements in Chromium. The real product carrier separately measures twenty same-session multi-view activations and twenty `top` resizes, with each resize capped at 150 ms. It also verifies clear, history projection, refresh, controller transfer, one semantic canvas, canonical frame geometry, DPR backing, nontransparent paint, and zero page, console, request, or response errors.

# Boundaries

Redeven may adapt Flowersec streams, product permissions, local-path capability, responsive placement, notifications, and Desktop URL/file actions. It must not recreate terminal parsing, key encoding, history ownership, attachment arbitration, canonical geometry, semantic frame encoding, cursor state, graphics state, or renderer internals. Local sibling dependencies, raw-byte fallbacks, hidden renderers, automatic reattach on ordinary resize, error swallowing, and sequence rollback are prohibited.

# Evidence

- `redeven:internal/terminal/manager.go` - Registers terminal-go live, semantic history, clear, catalog, and lifecycle boundaries.
- `redeven:internal/terminal/live_stream_test.go` - Proves permission admission and generation-scoped actor-owned clear.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalTransport.ts` - Adapts one Floeterm live stream and generation-bound semantic RPC controls.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx` - Thin product runtime around RendererSurface, TerminalInputBridge, history projection, and attachment lifecycle.
- `redeven:internal/envapp/ui_src/src/ui/widgets/semanticTerminalViewport.ts` - View-local viewport, link hit-testing, and capability-neutral presentation helpers.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.semantic.browser.test.tsx` - Direct semantic renderer, input, history, theme, resize, and performance coverage.
- `redeven:internal/envapp/ui_src/scripts/checkSemanticTerminalCarrier.mjs` - Real Runtime, PTY, Activity, Workbench, clear, top resize, refresh, and multi-view carrier.
- `redeven:internal/session/dependency_contract_test.go` - Published dependency and legacy package exclusion contract.
