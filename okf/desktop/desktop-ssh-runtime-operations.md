---
type: Desktop Contract
title: Desktop SSH runtime operations
description: Shared SSH transport, operation generations, host discovery, and process inventory authority.
tags: [desktop, ssh, runtime, process]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Desktop shares one lazy SSH transport manager across Runtime and related remote operations, with lease generations fencing retries and master replacement. Welcome resolves concrete SSH aliases and coordinates probes by physical host. Desktop-managed process authority comes from the scoped Runtime Process Inventory rather than startup-report PIDs, current locks, or in-memory readiness records.

# Contract

## Mechanism

Desktop owns one lazy `DesktopSSHTransportManager` for all Runtime, container, Gateway, probe, and bridge SSH work. Its host key includes normalized destination, port, authentication mode, SSH binary, and password credential scope; key-agent targets may share by host, while password targets remain isolated by their explicit saved-record scope. Concurrent acquisitions coalesce onto one `ControlMaster=yes`, `ControlPersist=no` startup. The manager owns the socket directory, askpass script, master process, command channels, generation, and cleanup. It does not preconnect. A released final lease starts a 90-second idle close so the existing 30-second health freshness window can reuse the same master, while Desktop shutdown disposes every remaining transport after sessions close.

Every bootstrap, install, inventory, Start, Stop, Restart, and Update transaction pins one manager lease generation. A master exit invalidates that generation; the current transaction terminates as `ssh_connection_interrupted` and never acquires a replacement generation, retries a command, falls back from Desktop upload to remote install, or selects another transport. Every nonzero multiplexed command is followed by one deterministic manager-owned `ssh -O check`. If the master remains healthy, the current phase reports the real remote command failure; if it is unhealthy, interruption diagnostics retain the failed command output and one final control-check result without successful readiness-poll noise. Only an already established steady-state bridge may acquire a later generation. It retries with 1, 2, 5, 10, and then capped 30-second delays while its window/session remains alive.

Desktop Welcome reads concrete SSH aliases from the user's SSH configuration through the main-process loader. The loader follows bounded `Include` directives, excludes wildcard and negated Host patterns from selectable targets, and returns the complete alias set rather than a presentation-sized subset. Entering any SSH-backed Environment or Gateway create/edit flow starts a fresh read; the picker retains the last successful set while refreshing, ranks exact and prefix alias matches before metadata matches, and keeps every result accessible inside a constrained scrolling list. Loading, read failure, empty configuration, and no-match states remain visible without blocking a manually entered `user@host` destination.

Desktop-managed process authority comes from the schema 2 Runtime Process Inventory, not the startup report PID, current state-root lock, in-memory ready record, or a status command exit code. Local, SSH, and container lifecycle paths share the same orthogonal identity, owner, current-layout, stop-authority, digest, executable-inode, user, and namespace rules documented in the Desktop runtime process lifecycle concept. Start and Open are observational. Stop, Restart, and Update proceed automatically only for current-owner processes; a fully verified process with missing or foreign owner evidence requires a digest-bound user confirmation, while any blocked identity prevents every signal.

# Boundaries

Runtime process inventory is an internal Desktop machine contract rather than a Runtime Service, OpenAPI, database, or plugin protocol. SSH and container inventory and stop commands always use a temporary helper extracted from the verified current Desktop runtime asset; installed runtimes are not process-contract implementations. The helper does not change the version-stable Restart package selection, does not activate Update staging, and is removed after governance completes.

# Evidence

- `redeven:okf/desktop/desktop-runtime-process-lifecycle.md:1` - Runtime process inventory and lifecycle ordering are maintained as a separate Desktop contract.
- `redeven:desktop/src/main/sshConfigHosts.ts:104` - SSH configuration discovery admits concrete aliases while excluding wildcard and negated Host patterns.
- `redeven:desktop/src/welcome/App.tsx:3249` - Welcome refreshes SSH aliases when an SSH-backed dialog entry becomes active and preserves previous results across refresh failures.
- `redeven:desktop/src/welcome/sshConfigHostOptions.ts:30` - SSH picker filtering returns all candidates and ranks alias matches before host metadata matches.
- `redeven:desktop/src/main/desktopSessionContext.ts:5` - Desktop main maps every target to a complete session snapshot and assigns the remote route to SSH, Gateway, and External targets.
