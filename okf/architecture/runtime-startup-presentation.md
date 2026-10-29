---
type: Runtime Contract
title: Runtime startup presentation
tags: [architecture, runtime, startup, desktop]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`redeven run` startup is modeled as a lifecycle event stream. Human terminal output and public machine events are renderers over the same state snapshot, while a separate private Desktop report carries machine-only attach data and stable failure codes needed to open or recover the local Env App safely.

# Contract

## Mechanism
The run command parses `--mode`, `--local-ui-bind`, `--startup-report-file`, and `--presentation`. Ready and attached reports require `local_ui_bridge_url` plus a canonical 256-bit `local_ui_bridge_token`, validate both before atomic write, and retain public `local_ui_url(s)` separately for display and external access.

The original error remains available only as technical detail.

# Boundaries

Desktop readiness must come from the machine presentation and startup-report contract, not from scraping rich terminal output. The Desktop startup envelope is a one-shot process handoff, not a public automation format or a reason to reintroduce command-line secret flags.

# Evidence

- `redeven:cmd/redeven/main.go:222` - Run mode defaults to local and accepts explicit remote, hybrid, local, or desktop values.

- `redeven:cmd/redeven/desktop_startup_coordination.go:20` - Launch reports are enabled only for machine-readable desktop-mode startup with a report path.

- `redeven:internal/runtimepresentation/events.go:1` - Startup phases and event payloads live in the runtimepresentation package.
