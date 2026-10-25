---
type: Desktop Contract
title: Desktop Environment registration ownership
description: Single registration owners, versioned connection records, serialized persistence, and generation-safe removal.
tags: [desktop, environments, persistence, ssh, wsl, runtime, launcher]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Each Environment action names one registration owner: `local_environment` for built-in Local, `runtime_target` for WSL/SSH/containers, `saved_environment` for URLs, or the Gateway-held member identity. Linked cards never choose storage or mutation behavior. Desktop serializes changes against current preferences, immediately publishes committed snapshots and fences late probes/Open tasks so removed registrations cannot reappear.

# Contract

- Create, edit, rename, pin and remove use generic actions with explicit `EnvironmentRegistrationRef`, never renderer kinds or placement inference.
- First WSL registration fills an empty default; explicit selection replaces it; deletion clears it atomically.
- Only the one-time migration decodes retired SSH catalogs. Match destination, port and normalized root; transfer credentials/settings, preserve current Runtime Target names and remove duplicate built-in Local projections without touching remote targets. Remove this decoder/journal only when the supported catalog minimum excludes that schema.
- Every Launcher Operation declares `active_progress_surface`: `open`, `runtime_lifecycle`, `reinstall` or `gateway`. Main/renderer title, details and cancellation consume it without a replacement timeline.
- [SSH settings](desktop-ssh-environment-settings.md) owns fields; [WSL operations](desktop-wsl-runtime-operations.md) owns discovery and lifecycle.

# Boundaries

Desktop owns registration metadata only. Editing/removing it never deletes Runtime, Gateway, WSL or remote resources or changes their policy.

# Evidence

- `redeven:desktop/src/shared/desktopLauncherIPC.ts:1` - Explicit registration reference and progress-surface contracts.

- `redeven:desktop/src/main/desktopEnvironmentRegistrationMigration.ts:1` - Sole retired SSH decoder and idempotent canonical migration.

- `redeven:desktop/src/main/desktopPreferences.ts:1` - Canonical preference owners and non-resurrecting mutations.
