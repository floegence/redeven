---
type: Runtime Contract
title: Runtime system monitoring
tags: [architecture, runtime, monitoring]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Monitor owns one CPU/memory/network/process snapshot for page and Workbench. All OS-marked loopback interfaces are excluded from the shared network counters/rates. Failed network samples never enter history or fall back to unfiltered totals; later samples recover independently while other metrics remain usable.

# Contract

## Sampling and presentation
The service refreshes system metrics every two seconds and process metrics every ten seconds.

Totals are not a persisted usage ledger and are not reset to zero when Redeven starts.

## Network accounting
Each sample reads interface metadata through Go's `net.Interfaces()` and individual byte counters through the published gopsutil per-interface API.

Interface topology changes retain the existing aggregate-counter rate behavior rather than introducing a second rate algorithm.

# Boundaries

## Failure and recovery
Interface enumeration, counter reads, cancellation, and a counter entry without matching interface metadata fail that network sample without publishing a partial sum.

Existing client request errors retain their Retry action, subsequent polling, and cleanup on unmount.

# Evidence

- `redeven:internal/monitor/service.go` - Source.
- `redeven:internal/monitor/network_counters_test.go` - Tests.
