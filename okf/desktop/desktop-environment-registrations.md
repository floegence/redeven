---
type: Desktop Contract
title: Desktop Environment registration ownership
description: Single registration owners, one-time SSH migration, serialized persistence, and generation-safe removal.
tags: [desktop, environments, persistence, ssh, runtime, launcher]
timestamp: 2026-08-23T00:00:00Z
---
# Summary

Each Environment card has one authoritative registration owner. Built-in Local Environment uses `local_environment`; SSH host and Local/SSH container targets use `runtime_target`; URL entries use `saved_environment`; Gateway-backed entries use their Gateway profile. Renderer display kinds never select storage, edit, pin, rename, or removal behavior. Desktop serializes registration mutations against the latest preferences state, broadcasts the committed snapshot immediately, and prevents late probes or Open tasks from recreating a removed registration.

# Contract

Every actionable card carries an explicit `EnvironmentRegistrationRef`. Create, edit, rename, pin, and remove route through the generic registration actions and that reference; Renderer presentation kinds and placement fields never select a persistence action. An SSH destination is connection identity, while the Runtime Target label is user-visible metadata; changing the label does not change the SSH destination. Removal deletes only the Desktop registration, publishes the new snapshot before background session and bridge cleanup, and never deletes remote Redeven data. A missing registration is a typed failure rather than a successful no-op.

Preferences mutations form one serialized queue. Each mutation reads the latest committed value and writes only its owner fields. Long-running Open, probe, and lifecycle work may update health, operation, or `last_used_at` only while the registration still exists. Removal advances the Launcher subject generation before background cleanup, so results from an earlier generation cannot reintroduce a card. Pinning and use-time updates never upsert a missing registration.

# Boundaries

Desktop owns registration metadata, persistence, and presentation. Runtime, Gateway, and remote targets retain ownership of remote data, lifecycle authority, and access policy; removing or changing a Desktop registration never mutates those upstream resources.

# Legacy SSH migration

The retired standalone SSH catalog shape is decoded only by the one-time Environment registration migration module. Migration matches SSH host Runtime Targets by destination, port, and normalized Runtime root, transfers credentials and settings, preserves the current visible Runtime Target name, removes duplicate Runtime Target projections of the built-in Local Environment, and never connects to or modifies the remote target.

Migration writes an external journal before committing canonical catalogs. The journal contains the complete encoded retired registration and secret source needed to resume after a partial catalog or secret write; normal preference code treats that payload as opaque migration data. A crash before commit repeats the conversion without losing SSH credentials or settings; a crash after commit observes canonical Runtime Targets and removes the stale journal. The migration is idempotent. Normal `DesktopPreferences`, Welcome projection, and launcher actions contain no retired SSH registration collection or SSH-specific CRUD path. The decoder and journal payload can be deleted when the minimum supported catalog version no longer includes the retired SSH schema.

# Operation presentation

Every Launcher Operation declares one `active_progress_surface`: `open`, `runtime_lifecycle`, `reinstall`, or `gateway`. Renderer panels and main-process title, detail, and cancellation presentation read only that surface; Renderer never fabricates a long-lived replacement timeline. A lifecycle operation started directly owns and completes its Operation. A lifecycle recovery invoked by Open is a child stage: it updates Runtime progress without finishing or scheduling removal of the parent, then explicitly returns ownership to Open. The renderer creates and binds lifecycle disclosure to the exact `operation_key` and `started_at_unix_ms`. Lifecycle timeline selection never chooses an attempt by recency or combines retained and current operations for the same Environment.

The main-process Launcher Operation Registry timestamps the active step. Repeated detail or task updates preserve that timestamp; entering a different step starts a new one. Renderer computes elapsed time from the selected active surface and that snapshot timestamp, so opening, closing, or reopening a progress popup never starts or resets the clock.

# Evidence

- `redeven:desktop/src/shared/desktopLauncherIPC.ts:1` - Explicit registration reference and progress-surface contracts.
- `redeven:desktop/src/main/desktopEnvironmentRegistrationMigration.ts:1` - Sole retired SSH decoder and idempotent canonical migration.
- `redeven:desktop/src/main/desktopPreferences.ts:1` - Canonical preference owners and non-resurrecting mutations.
- `redeven:desktop/src/main/desktopWelcomeState.ts:1` - One card projection per canonical registration owner.
- `redeven:desktop/src/main/launcherOperations.ts:1` - Required active surface and subject generation.
- `redeven:desktop/src/main/main.ts:1` - Serialized persistence, atomic removal, and parent/child operation ownership.
- `redeven:desktop/src/welcome/environmentLifecycleDisclosure.ts:1` - Exact attempt binding.
- `redeven:desktop/src/welcome/environmentProgressPrimaryPresentation.ts:1` - Active-surface-only progress and recovery actions.
- `redeven:desktop/src/welcome/environmentProgressMeter.ts:1` - Snapshot-based progress percentage and elapsed-time projection.
