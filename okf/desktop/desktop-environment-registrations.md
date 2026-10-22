---
type: Desktop Contract
title: Desktop Environment registration ownership
description: Single registration owners, versioned connection records, serialized persistence, and generation-safe removal.
tags: [desktop, environments, persistence, ssh, wsl, runtime, launcher]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Each Environment action surface has one authoritative registration owner. Built-in Local Environment uses `local_environment`; WSL, SSH host, and Local/SSH container targets use `runtime_target`; URL entries use `saved_environment`; Gateway-backed entries use the member identity held by their Gateway. A linked Runtime and Provider Environment may share one visual relationship card, but every action surface still names the exact owner entry and Renderer display grouping never selects storage, edit, pin, rename, or removal behavior. Desktop serializes registration mutations against the latest preferences state, broadcasts the committed snapshot immediately, and prevents late probes or Open tasks from recreating a removed registration.

# Contract

Registered Runtime, URL, and Gateway action surfaces carry an explicit `EnvironmentRegistrationRef`. Create, edit, rename, pin, and remove route through the generic registration actions and that reference; Renderer presentation kinds and placement fields never select a persistence action.

The first WSL registration fills an empty default, explicit selection replaces it, and deleting that target clears the reference in the same preference mutation.

The retired standalone SSH catalog shape is decoded only by the one-time Environment registration migration module. Migration matches SSH host Runtime Targets by destination, port, and normalized Runtime root, transfers credentials and settings, preserves the current visible Runtime Target name, removes duplicate Runtime Target projections of the built-in Local Environment, and never connects to or modifies the remote target.

The decoder and journal payload can be deleted when the minimum supported catalog version no longer includes the retired SSH schema.

Every Launcher Operation declares one `active_progress_surface`: `open`, `runtime_lifecycle`, `reinstall`, or `gateway`. Renderer panels and main-process title, detail, and cancellation presentation read only that surface; Renderer never fabricates a long-lived replacement timeline.

SSH fields follow [Desktop SSH environment settings](desktop-ssh-environment-settings.md).

# Boundaries

Desktop owns registration metadata, persistence, and presentation. Runtime, Gateway, WSL, and remote targets retain ownership of external data, lifecycle authority, and access policy; removing or changing a Desktop registration never deletes those resources. WSL-specific discovery and lifecycle behavior is owned by [Desktop WSL runtime operations](desktop-wsl-runtime-operations.md).

# Evidence

- `redeven:desktop/src/shared/desktopLauncherIPC.ts:1` - Explicit registration reference and progress-surface contracts.

- `redeven:desktop/src/main/desktopEnvironmentRegistrationMigration.ts:1` - Sole retired SSH decoder and idempotent canonical migration.

- `redeven:desktop/src/main/desktopPreferences.ts:1` - Canonical preference owners and non-resurrecting mutations.
