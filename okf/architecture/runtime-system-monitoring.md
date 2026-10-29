---
type: Runtime Contract
title: Runtime system monitoring
tags: [architecture, runtime, monitoring]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Monitor service owns environment CPU, memory, network, and process sampling. Its cached snapshot is the authority for both the Monitoring page and Workbench. Network byte totals and rates exclude every interface marked as loopback by the operating system and share one filtered counter source. A failed network sample never enters rate history or falls back to all-interface totals; later valid background samples recover automatically while other resource sampling continues.

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

- `redeven:internal/monitor/service.go` - Sole collectors, loopback filtering, snapshot publication, and cached RPC access.

- `redeven:internal/monitor/network_counters_test.go` - Flag-based accounting, failure isolation, cancellation, and automatic recovery.
