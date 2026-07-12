---
type: Runtime Contract
title: Runtime transport dependencies
description: Runtime transport uses Flowersec sessions while terminal lifecycle is delegated to Floeterm managers.
tags: [architecture, dependencies, terminal]
timestamp: 2026-06-17T00:00:00Z
---

Redeven runtime builds control and data sessions on Flowersec client and endpoint primitives, while terminal lifecycle inside the runtime is delegated to Floeterm's terminal-go manager.

# Mechanism

Redeven pins released `flowersec-go` and `terminal-go` versions in `go.mod`. The agent connects the control channel through `fsclient.ConnectDirect`, opens data sessions through `endpoint.ConnectTunnel`, and wraps `termgo.NewManager` so terminal sessions, PTY activation, history accounting, and shell lifecycle setup stay inside Floeterm's manager abstraction. Redeven configures an 8 MiB history byte budget per session in addition to Floeterm's chunk bound, without configuring or enforcing a session-count limit. Redeven selects the shell and cache location, while released Floeterm providers generate Bash, Zsh, Fish, and POSIX initialization and OSC command lifecycle markers. Concurrent direct close, widget cleanup, and process-exit paths share one in-flight delete result per session. Closing sessions reject interaction immediately; successful cleanup removes the record, while a real cleanup failure restores an open, visible, retryable lifecycle with diagnostics.

# Boundaries

Compatibility depends on these transport and terminal interfaces staying aligned across released versions. Replacing or bypassing them can break control and data channel behavior, sparse history coverage, command lifecycle events, or terminal session lifecycle. History and session diagnostics are observability signals only: neither Redeven nor Floeterm may use session count to reject creation, automatically close a PTY, or pause an existing session. Frontend renderer hibernation is not a runtime lifecycle transition: disposing an inactive `TerminalCore` must leave the terminal-go session and PTY running, and later snapshot or paged-history recovery resumes only the visual consumer.

# Citations

[1] redeven:go.mod:8 - Redeven pins floeterm terminal-go in the runtime module.
[2] redeven:go.mod:9 - Redeven pins flowersec-go in the runtime module.
[3] redeven:internal/agent/agent.go:20 - Agent imports Flowersec client, endpoint, proxy, and RPC packages.
[4] redeven:internal/agent/agent.go:532 - The control channel connects through fsclient.ConnectDirect.
[5] redeven:internal/agent/agent.go:688 - Runtime data sessions connect through endpoint.ConnectTunnel.
[6] redeven:internal/terminal/manager.go:14 - Runtime terminal manager wraps floeterm terminal-go plus Flowersec RPC types.
[7] redeven:internal/terminal/manager.go:98 - Runtime configures the released terminal-go manager.
[8] redeven:internal/terminal/manager.go:104 - Each terminal session uses an 8 MiB history byte bound without a manager session limit.
[9] redeven:internal/terminal/manager.go:105 - Floeterm default providers own shell arguments, init files, and command lifecycle markers.
[10] redeven:internal/terminal/lifecycle.go:190 - Concurrent delete callers join one session-scoped in-flight cleanup operation.
[11] redeven:AGENTS.md:173 - Repository rules require published upstream releases instead of local sibling checkouts.
