---
type: Runtime Contract
title: Runtime terminal lifecycle
tags: [architecture, runtime, terminal, floeterm]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Floeterm owns PTY/Ghostty VT, geometry/controller epoch, input encoding, history/reset and atomic Presentation. Redeven maps permission/session metadata/placement. Browser consumes bounded semantic streams without parsing bytes or introducing a second terminal state machine.

# Contract

The runtime wraps `termgo.NewManager` so one terminal-go `SessionActor` owns each PTY, native Ghostty VT, canonical geometry, controller epoch, input encoding, semantic history, clear/reset, and atomic Presentation.

Overflow fixtures may exceed the 8 MiB ring-buffer cap; they must recover the retained tail, preserve the stable renderer geometry after focus, and accept subsequent PTY input.

## Terminal startup and warmup
Env App hydrates one terminal session catalog after protocol connection, environment readiness, and process permission. The catalog owns canonical session metadata, notification convergence, connection epoch, permission clearing, stale-on-disconnect state, and bounded early latest values.

Diagnostics retain aggregate phase and field-presence facts only and never record session identifiers, paths, remote identity, commands, or terminal content.

## Native history budgets
Runtime persists `terminal_history_retention` with nullable `max_lines`/`max_bytes` safe nonnegative integers and applies those defaults before terminal readiness. Published terminal-go owns validation, native limit application, pruning, snapshot invalidation and atomic Presentation. Defaults affect only subsequently created sessions; existing sessions are never silently reconfigured.

`/_redeven_proxy/api/terminal/history-retention` is the product settings adapter: GET reads defaults or an authorized session; admin-only PUT persists and activates defaults; POST applies explicit limits to a session using its connection ID and transport generation. Session application reuses shell/container permission and ownership checks, is principal-bound, does not transfer controller ownership, and rejects stale attachments. Limits preserve process, live screen, geometry and content epoch, while invalidating historical snapshots through the upstream history epoch. No local implementation of terminal retention or RPC retry is introduced.

# Boundaries

Terminal lifecycle depends on the published Floeterm and Flowersec interfaces. Redeven must not parse terminal bytes, keep another history, replay raw output, add browser VT/WASM fallbacks, or introduce a second attachment or controller owner. History and diagnostics remain observational and never become admission limits.

# Evidence

- `redeven:internal/terminal/manager.go:14` - Source.
- `redeven:internal/terminal/semantic_history_rpc_test.go` - Tests.
