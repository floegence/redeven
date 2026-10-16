---
type: Runtime Contract
title: Runtime system monitoring
description: Sample environment resources once and report network totals and rates from non-loopback interfaces.
tags: [architecture, runtime, monitoring]
timestamp: 2026-10-16T00:00:00Z
---
# Summary

The Monitor service owns environment CPU, memory, network, and process sampling. Its cached snapshot is the authority for both the Monitoring page and Workbench. Network byte totals and rates exclude every interface marked as loopback by the operating system and share one filtered counter source. A failed network sample never enters rate history or falls back to all-interface totals; later valid background samples recover automatically while other resource sampling continues.

# Contract

## Sampling and presentation

The service refreshes system metrics every two seconds and process metrics every ten seconds. The existing system-monitor RPC reads cached data rather than collecting on request. Page and Workbench consume the same response; neither creates a sampler or subtracts traffic in the browser. Runtime version and process start time remain owned by `sys.ping`. Snapshot access and process termination follow the [runtime session permission gates](runtime-session-permission-gates.md).

The existing network response fields retain their names, types, and units: `network_bytes_received` and `network_bytes_sent` are cumulative interface byte counters; `network_speed_received` and `network_speed_sent` are bytes per second. Totals are not a persisted usage ledger and are not reset to zero when Redeven starts.

## Network accounting

Each sample reads interface metadata through Go's `net.Interfaces()` and individual byte counters through the published gopsutil per-interface API. Interface names associate the two readings; the operating system's `FlagLoopback` is the sole exclusion rule. Names such as `lo` and `lo0`, addresses, administrative up/down state, and physical/virtual classifications do not independently determine inclusion. Metadata is read afresh each cycle.

All matched non-loopback counters are summed once. The four response values derive from this filtered sum through the existing six-second rate window. An initial sample or a window with fewer than two valid samples has zero speed. Counter decreases retain the existing non-negative rate protection. A Runtime restart creates fresh in-memory rate history.

No interfaces, no counter entries, or only loopback interfaces yield valid zero totals. Bridges, tunnels, and other non-loopback interfaces remain included. These totals describe non-loopback interface traffic, not Internet-only or deduplicated physical-link traffic. Interface topology changes retain the existing aggregate-counter rate behavior rather than introducing a second rate algorithm.

# Boundaries

## Failure and recovery

Interface enumeration, counter reads, cancellation, and a counter entry without matching interface metadata fail that network sample without publishing a partial sum. Context cancellation is checked before sampling and after both reads. There is no internal retry, cached classification, name-based fallback, or return to all-interface aggregation.

The service logs the network error, leaves its rate history untouched, and publishes the existing zero network fields for that sample alongside other available system metrics. The response does not add a network-availability flag: zero traffic and a failed network sample remain indistinguishable to the client, with diagnostics available in the Runtime log.

The next regular cycle reads both sources again. Recovery uses only valid samples still inside the existing rate window; after a long gap, it waits for sufficient valid samples to calculate a rate. No user action or Runtime restart is required for sampling recovery. Existing client request errors retain their Retry action, subsequent polling, and cleanup on unmount.

# Evidence

- `redeven:internal/monitor/service.go` - Sole collectors, loopback filtering, snapshot publication, and cached RPC access.
- `redeven:internal/monitor/network_history.go` - Windowed rates and counter-decrease protection.
- `redeven:internal/monitor/network_counters_test.go` - Flag-based accounting, failure isolation, cancellation, and automatic recovery.
- `redeven:internal/monitor/service_test.go` - Cached reads and monitoring/process permission boundaries.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RuntimeMonitorPanel.test.tsx` - Shared page/Workbench zero-rate rendering, Retry recovery, and polling cleanup.
