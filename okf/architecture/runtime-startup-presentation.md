---
type: Runtime Contract
title: Runtime startup presentation
description: redeven run startup output is structured events rendered by rich, plain, or machine presentation modes.
tags: [architecture, runtime, startup, desktop]
timestamp: 2026-06-17T00:00:00Z
---
# Summary

`redeven run` startup is modeled as a lifecycle event stream. Human terminal output and public machine events are renderers over the same state snapshot, while a separate private Desktop report carries machine-only attach data and stable failure codes needed to open or recover the local Env App safely.

# Contract

## Mechanism

The run command parses `--mode`, `--local-ui-bind`, `--startup-report-file`, and `--presentation`. When `--mode` is omitted, it defaults to local mode, starts the loopback-only Local UI, and does not require bootstrap configuration or enable the control channel. Explicit remote, hybrid, local, and desktop modes retain their mode-specific behavior. A machine presentation with `--startup-report-file` is the private Desktop startup handoff; the command initializes a `runtimepresentation.Reporter`, emits phase events as state, lock, bootstrap, config, control, and Local UI phases progress, and writes a private `0600` launch report when a desktop-mode Local UI becomes ready. Ready and attached reports require `local_ui_bridge_url` plus a canonical 256-bit `local_ui_bridge_token`, validate both before atomic write, and retain public `local_ui_url(s)` separately for display and external access.

Startup secrets never use literal command-line values. Ordinary CLI startup accepts hidden password prompting, stdin, protected files, or fixed secret environment fallbacks. `--bootstrap-ticket-stdin` reads without echo when stdin is an interactive terminal, while preserving prompt-free pipe and redirect behavior for automation. Explicit sources override fixed environment values, empty environment values are ignored, and secret variables are removed from child process environments before any command can start a child process. Diagnostics record only the source category. Machine startup instead sends one version 1 JSON envelope through private stdin, with a 64 KiB limit and a hard conflict against every other secret source.

A blocked Desktop report keeps the startup phase in `code` and carries a stable cause in `diagnostics.failure_code`. A wrapped database-kind mismatch reports `startup_failed` with `runtime_state_incompatible`; Desktop must use that machine code, never localized error text, to select user-confirmed wipe reinstall. The original error remains available only as technical detail.

# Boundaries

Desktop readiness must come from the machine presentation and startup-report contract, not from scraping rich terminal output. The startup report is a private machine handoff protected by its file mode; it may carry `local_ui_bridge_url`, `local_ui_bridge_token`, and runtime-control credentials that public events, diagnostics, and user-facing projections must omit. The compact character mark remains a rich renderer concern rather than command startup logic. The Desktop startup envelope is a one-shot process handoff, not a public automation format or a reason to reintroduce command-line secret flags.

# Evidence

- `redeven:cmd/redeven/main.go:222` - Run mode defaults to local and accepts explicit remote, hybrid, local, or desktop values.
- `redeven:cmd/redeven/desktop_startup_coordination.go:20` - Launch reports are enabled only for machine-readable desktop-mode startup with a report path.
- `redeven:internal/runtimepresentation/events.go:1` - Startup phases and event payloads live in the runtimepresentation package.
- `redeven:cmd/redeven/main.go:823` - Desktop-ready launch reports include public Local UI, the private trusted bridge, runtime-control, state, and Runtime Service details.
- `redeven:cmd/redeven/desktop_launch_report.go:123` - Ready and attached private reports validate the required trusted Local UI bridge URL before atomic write.
