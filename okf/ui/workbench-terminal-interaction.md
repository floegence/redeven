---
type: UI Contract
title: Workbench terminal interaction
description: Terminal attachment, input-plane ownership, focus, retained history, and performance validation.
tags: [ui, workbench, terminal, performance]
timestamp: 2026-07-19T00:00:00Z
---
# Summary

Activity and Workbench terminals use Floeterm's single binary `terminal/live_v1` data path over a Flowersec named Yamux stream. Each mounted view owns an independent connection identity and reports its own host capacity, while Floeterm owns the shared PTY geometry, atomic history boundary, ordered output, input, resize acknowledgement, and explicit close/error states. Redeven keeps catalog and history RPCs as a control plane and never falls back to the removed RPC live transport.

# Contract

## Live attachment and multi-view geometry

Every visible terminal view opens `terminal/live_v1`, sends one binary `ATTACH`, and receives an atomic history boundary plus history and geometry generations. Live output begins strictly after that boundary; retained history at or before the boundary is fetched through bounded RPC pages and committed through the paged output coordinator. Missing, malformed, or discontinuous sequence metadata fails closed. Disconnect recovery opens a new named stream and repeats the same attach-and-boundary procedure; it does not switch transports or silently discard output.

Each `TerminalPanel` allocates a fresh connection id, including panels in another browser page or another view in the same page. Views may report different column and row capacities. Floeterm computes the effective PTY grid from all attached connections and broadcasts one geometry generation with an exact output-sequence boundary. Redeven keeps every view's host reporting enabled even while it renders a fixed shared grid, queues geometry events until output through the boundary has reached the parser, and splits a render batch when the boundary falls inside it. Therefore two views apply the same resize between the same output sequences even when their DOM sizes differ. No page claims exclusive attachment ownership and no focus-dependent retry state machine serializes concurrent views.

Input and resize use the same binary stream. Input bytes are forwarded exactly once and repeated characters remain repeated. Resize promises resolve only after the matching `RESIZE_APPLIED`; a stream end, protocol error, permission denial, missing session, slow consumer, or session close remains an explicit state. `SESSION_CLOSED` removes the session without presenting an ordinary reconnect error. Server error codes are structured Floeterm values rather than parsed message text or legacy RPC status codes.

## Product lifecycle and performance

The Env catalog stays renderer-free and does not statically import the live client, codec, renderer, or Terminal feature chunk. Dormant sessions remain metadata-only. Active-session history warmup may prepare bounded renderer-neutral pages, but it never attaches, resizes, subscribes, starts a PTY, or allocates a Core. Activity and Workbench share catalog state while each mounted runtime owns its Core, live stream, output coordinator, fixed geometry application, focus lifecycle, and working-set snapshot.

Terminal input-plane behavior remains upstream-owned. Redeven consumes released Floeterm APIs and verifies native focus, IME, canvas geometry, retained history, ordered shell integration, clear/delete behavior, and multi-view resize without compatibility branches. Mobile keyboard retention does not imply textarea autofocus. Surface disposal invalidates asynchronous reload and writer work so an unmounted surface cannot reopen a stream later.

Fixed-performance validation remains separate from ordinary hosted timing. Deterministic tests enforce sequence continuity, parser ordering, no fallback, bundle boundaries, and no silent drop. Controlled-runner reports cover key-to-paint, high-volume output, render frames, UI responsiveness, reconnect leakage, and same-session multi-view resize/content convergence. Activity and Workbench may have different host sizes, but both must converge on the protocol geometry generation and output boundary rather than accepting coarse content divergence as normal.

# Boundaries

Redeven may map Flowersec `openStream("terminal/live_v1")` into Floeterm's byte-stream adapter and may provide RPC catalog/history operations. It must not recreate Floeterm framing, attachment arbitration, effective-grid calculation, input sequencing, resize acknowledgement, output batching, slow-consumer policy, or error-code semantics. RPC type ids 2003 through 2006 are intentionally unregistered and have no SDK codec, debug projection, queue, or fallback path. Control notifications such as session-list and name/working-directory changes remain RPC control-plane events and are synchronously offered to every authorized client; the receiving view filters by session.

# Evidence

- `redeven:internal/agent/agent.go` - Runtime registers the Flowersec `terminal/live_v1` named stream.
- `redeven:internal/terminal/manager.go` - The terminal manager serves the Floeterm live service and keeps only catalog, history, lifecycle, and notification RPC control operations.
- `redeven:internal/terminal/live_stream_test.go` - Tests enforce process permission and prove legacy live RPC type ids are not registered.
- `redeven:internal/agent/terminal_live_stream_test.go` - Named-stream tests cover permission rejection plus authorized attach and acknowledged resize.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalTransport.ts` - Env App adapts Flowersec `openStream` to Floeterm live transport with no RPC live fallback.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalCatalogTransport.ts` - Catalog and paged history stay isolated from the live and renderer bundle.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx` - Runtime applies shared geometry at its output boundary and reports host capacity while rendering the fixed grid.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.browser.test.tsx` - Chromium coverage checks output-before-boundary, geometry application, and output-after-boundary ordering.
- `redeven:internal/envapp/ui_src/scripts/checkInitialBuildBudget.mjs` - Production build policy rejects Terminal live or renderer modules in the initial catalog graph.
- `redeven:internal/envapp/ui_src/scripts/checkTerminalRecoveryCarrier.mjs` - The process carrier validates real Runtime, PTY, parser, canvas, input, and retained-history behavior.
