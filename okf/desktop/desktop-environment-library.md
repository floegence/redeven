---
type: Desktop Contract
title: Environment library, registrations and card presentation
tags: [desktop, environment, cloud, welcome]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Welcome projects authoritative registration owners into a stable library. Exact Runtime/Cloud links and verified Gateway routes may share cards, without transferring lifecycle or storage authority. Explicit actions name their owner; snapshots preserve drafts, focus and pending work while late replies cannot resurrect removed records.

# Contract

## Library
- Show the Environment title, description and search/refresh/create actions. Keep counts on category filters and Runtime/window states on cards; show current snapshot issues below the description without reserving an empty row.
- Pair Local/SSH/WSL with Cloud only when linked Runtime ID, Cloud origin, Cloud ID and ENV ID agree. Access-point origin is routing metadata. Current health outranks old window reports; retained display grants no control.
- Search/equivalent snapshots preserve selection; source defaults apply once. Trusted Gateway summaries show name, endpoints, attachment identity/phase and selected egress dependency. One member needs no selector; refresh cannot restore retired selections or confirmation substitute missing members. Preserve menu order/capability checks.
- Cloud uses one section per signed-in account and a shared grid. Offer Refresh normally/after sync failure, Sign in again after expiry. Either owner pin puts the group in Pinned; controls change only the active owner and explain the other pin.

## Registration ownership
Each action names Local, Runtime target, saved URL or Gateway-member storage ownership. Desktop serializes writes, publishes committed snapshots immediately and fences late probe/Open replies so removed records cannot return.

- Create/edit/rename/pin/remove use explicit `EnvironmentRegistrationRef`, never renderer kind or placement inference. First WSL registration fills an empty default; explicit selection replaces it; deletion clears it atomically.
- The one-time retired SSH-catalog migration matches destination, port and normalized root, transfers credentials/settings, preserves Runtime Target names and removes duplicate built-in Local projections without touching remote targets. Remove decoder/journal only when the supported catalog minimum excludes that schema.
- Every Launcher Operation declares `active_progress_surface`: `open`, `runtime_lifecycle`, `reinstall` or `gateway`. Main/renderer title, details and cancellation consume it without another timeline.

## Card presentation
- Cards retain one opaque theme-derived plane and a quiet, stable contour. Connected cards carry a restrained success tint; fine-pointer hover gently shifts the same plane without removing the tint, swapping gradients, adding shadows or moving controls. Shared Floe color timing reverses from the painted state; reduced motion settles immediately and touch never latches hover.
- Use **Open window** for unopened environments and **Show window** to focus existing sessions, preserving readiness, authority, lifecycle and session ownership. Use Environment/environment window/Redeven in settings, progress, recovery and titles; Env App is internal. Every shipped catalog translates the copy.
- Card controls stay single-line; long progress actions wrap. Four creation entries form an equal-column 2x2 grid. Copy log/Close share Floe outline treatment, widths and row height without translation overflow.
- Center primary content excluding the menu toggle; idle reserves no icon space. Submission shows loader/shimmer, accessible busy state and blocks repeat clicks; completion restores centered text. Keep geometry and icon-label grouping stable.
- Batch refresh owns the header until the batch settles. Each card refresh follows its own probe/request and stops independently. Observation never makes primary actions pending; card actions cannot release batch ownership, nor batch completion clear card actions.
- Runtime/Cloud/paired Gateway tabs occupy the standalone badge slot. Cloud auth/sync failure cannot disable Runtime actions. [Center navigation](desktop-welcome-navigation.md) preserves layout and never restarts on snapshots.

## Platform presentation
Last-known facts survive disconnect/restart until replaced; unknown OS never blocks Runtime or changes geometry, selection or focus.

- Trusted `runtime_platform`/optional `runtime_linux_distribution` arrive through startup/attach, health, management status and bridge hello. Only exact distribution ID selects its bundled mark, never `ID_LIKE`, names, Desktop identity, WSL labels or image names. Unknown Linux uses Tux; unknown platforms a device mark.
- Main persists `runtime_platform_facts` in existing UI state by environment kind/stable identity. Renderer storage cannot write it or make remembered facts health/access authority.
- Reserve a nonshrinking 1rem title slot, .875rem original-color OS mark and truncated single-line name. No tint/mask/grayscale. Localize accessibility copy, not brand names.

# Boundaries

Desktop owns registration metadata: edits/removal cannot delete Runtime/Gateway/WSL/remote resources or change policy. Recovery diagnostics are transient, not persistence or management authority. Platform display grants no access, lifecycle or plugin capability; [readiness](desktop-runtime-process-lifecycle.md#readiness) owns admission.

[Interaction continuity](desktop-interaction-continuity.md) owns drafts, authority, visibility and stale responses; [SSH settings](desktop-ssh-environment-settings.md) owns fields and [WSL operations](desktop-wsl-runtime-operations.md) discovery/lifecycle.

# Evidence

- `redeven:desktop/src/main/environmentAccess.ts` - Source.
- `redeven:desktop/src/main/runtimeConnectionProjection.test.ts` - Tests.

- `redeven:desktop/src/shared/desktopLauncherIPC.ts:1` - Source.
- `redeven:desktop/src/main/desktopPreferences.ts:1` - Source.

- `redeven:desktop/scripts/check-environment-card-tabs.mjs` - Tests.
- `redeven:desktop/scripts/check-welcome-compact-layout.mjs` - Tests.
- `redeven:desktop/scripts/check-welcome-card-hover.mjs` - All published palettes, intermediate color frames, rapid reversal, connection changes, reduced motion/forced colors/touch and real Local/SSH Welcome cards at desktop, tablet and phone widths.
- `redeven:desktop/scripts/check-welcome-cards.mjs` - Card contour and reading contrast across the current published material and theme matrix.
- `redeven:desktop/src/welcome/EnvironmentRelation.client.test.tsx` - Tests.
- `redeven:desktop/src/main/desktopWelcomeRefresh.test.ts` - Tests.

- `redeven:spec/openapi/rcpp-v5.yaml` - Source.
- `redeven:internal/runtimemanagement/runtime_platform_test.go` - Tests.
