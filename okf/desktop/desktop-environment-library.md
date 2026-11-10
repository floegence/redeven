---
type: Desktop Contract
title: Environment library, registrations and card presentation
tags: [desktop, environment, cloud, welcome]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Welcome projects registration owners into stable Environment cards. Title/description/search/refresh/create lead; categories carry counts, cards Runtime/window state. Snapshot errors appear only when present, without empty reserved rows. Current runtime health takes precedence over stale window reports.

# Contract

## Library
Pair Local/SSH/WSL with Cloud only when Runtime ID, Cloud origin/ID and ENV ID agree; access-point origin is routing. Current health outranks old window reports; display grants no control. Search/equal snapshots preserve selection; source defaults apply once. Gateway summaries retain trusted identity/endpoints/attachment/egress. One member needs no selector; refresh cannot restore retired choices or substitute missing members/confirmation. Keep menu order/capabilities.

Cloud groups by signed-in account in a shared grid. Refresh serves normal/sync-failure states; expiry offers Sign in again. Either owner's pin makes the group Pinned; controls affect active owner only and explain another pin.

## Registration ownership
Actions identify Local/Runtime target/URL/Gateway-member storage. Main serializes writes, immediately publishes committed snapshots and fences late probes/Open after removal. Explicit EnvironmentRegistrationRef, never renderer/placement inference, owns create/edit/rename/pin/remove. First WSL fills empty default; selection replaces, deletion clears atomically.

Retired SSH-catalog migration matches destination/port/normalized root, transfers credentials/settings, retains target names and removes duplicate built-in Local projections without remote mutation. Remove decoder/journal only when catalog minimum excludes it. Launcher declares active_progress_surface(open/runtime_lifecycle/reinstall/gateway); Main/renderer consume it without another timeline.

## Card presentation
One opaque themed plane/quiet contour, restrained connected-success tint and fine-pointer hover using reversible Floe color timing; no gradient swaps/shadows/moving controls. Reduced motion settles, touch cannot latch. Open window launches, Show window focuses, preserving authority/readiness/lifecycle. Localized Environment/environment window/Redeven replace internal Env App copy.

Single-line controls/whole wrapping long progress; four creation entries form equal2×2grid. Copy log/Close share outline/width/height without locale overflow. Center primary excluding menu, with no idle icon reservation; busy loader/shimmer blocks duplicates, restores centered text and preserves geometry.

Header owns batch refresh until all settle; each card owns its probe independently. Observations never make actions pending; batch/card completion cannot clear each other's ownership. Runtime/Cloud/paired Gateway tabs use badge slot; Cloud failure cannot disable Runtime. [Navigation](desktop-welcome-navigation.md) retains layout across snapshots.

## Platform presentation
Retain last facts through disconnect/restart; unknown OS changes neither admission nor geometry/focus. Trusted runtime_platform/runtime_linux_distribution come from startup/attach/health/management/hello. Only exact distribution ID selects bundled original-color mark, never ID_LIKE/names/Desktop/WSL/image inference. Unknown Linux=Tux, unknown platform=device.

Main persists runtime_platform_facts by stable environment identity in existing UI state; renderer cannot write or treat memory as health/access. Nonshrinking1rem slot contains .875rem untinted mark and truncated single-line name. Localize accessibility, not brand.

# Boundaries

Registration edits never remove Runtime/Gateway/WSL/remote resources or change policy. Diagnostics are transient; platform display grants no capabilities. [Readiness](desktop-runtime-process-lifecycle.md#readiness) owns admission, [continuity](desktop-interaction-continuity.md) drafts/authority/fencing, [SSH settings](desktop-ssh-environment-settings.md)/[WSL operations](desktop-wsl-runtime-operations.md) their fields/lifecycle.

# Evidence

 desktop/src/main/environmentAccess.ts and runtimeConnectionProjection.test.ts own projection/regressions.
