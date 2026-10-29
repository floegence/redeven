---
type: Runtime Contract
title: Runtime terminal lifecycle
tags: [architecture, runtime, terminal, floeterm]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floeterm terminal-go owns each PTY, native Ghostty VT, geometry, controller epoch, input encoding, semantic history, clear/reset, and atomic Presentation. Redeven maps permissions, session metadata, and Activity/Workbench placement around that actor; browser views consume bounded semantic streams and never become a second terminal state machine.

# Contract

The runtime wraps `termgo.NewManager` so one terminal-go `SessionActor` owns each PTY, native Ghostty VT, canonical geometry, controller epoch, input encoding, semantic history, clear/reset, and atomic Presentation.

Overflow fixtures may exceed the 8 MiB ring-buffer cap; they must recover the retained tail, preserve the stable renderer geometry after focus, and accept subsequent PTY input.

## Terminal startup and warmup
Env App hydrates one terminal session catalog after protocol connection, environment readiness, and process permission. The catalog owns canonical session metadata, notification convergence, connection epoch, permission clearing, stale-on-disconnect state, and bounded early latest values.

Diagnostics retain aggregate phase and field-presence facts only and never record session identifiers, paths, remote identity, commands, or terminal content.

# Boundaries

Terminal lifecycle depends on the published Floeterm and Flowersec interfaces. Redeven must not parse terminal bytes, keep another history, replay raw output, add browser VT/WASM fallbacks, or introduce a second attachment or controller owner. History and diagnostics remain observational and never become admission limits.

# Evidence

- `redeven:internal/terminal/manager.go:14` - Wraps published Floeterm terminal-go and Flowersec types.

- `redeven:internal/terminal/semantic_history_rpc_test.go` - Verifies viewport, continuation, lane, generation, and payload bounds.
