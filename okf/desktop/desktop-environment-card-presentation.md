---
type: Interaction Contract
title: Environment card presentation
description: Preserve compact Env card tabs, facts, action footers, focus and geometry across snapshots.
tags: [desktop, environment, interaction, accessibility]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-24"
---
# Summary

Environment cards preserve geometry across perspectives, snapshots, narrow layouts and long translations. Each perspective selects an explicit route without granting authority or falling back. Snapshots retain nodes, selection and focus; owner removal invalidates submission but retains open sessions.

# Contract

[Interaction continuity](desktop-interaction-continuity.md) owns authority, drafts, visibility and stale completions. Controls stay single-line.

## Window actions
All perspectives use **Open window** for unopened environments and **Show window** to focus an existing session. Labels preserve readiness, authority, lifecycle and session ownership.

Settings, progress, recovery and titles use Environment, environment window or Redeven. Env App is internal, never a label or brand. All shipped catalogs explicitly translate this copy.

## Alignment
Center visible content within the primary button, excluding the menu toggle. Idle text reserves no icon space. Submission shows a loader/shimmer, exposes busy state and blocks repeat clicks; completion restores centered text. Keep geometry fixed and meaningful icons grouped with labels.

## Perspectives and platform
Linked cards place Runtime, Redeven Cloud and paired Gateway tabs in the standalone badge slot. Cloud authorization or sync failure never disables Runtime actions. [Center navigation](desktop-welcome-navigation.md) transitions preserve card layout and do not restart on snapshots.

A bundled original-color OS mark beside the Runtime name reflects trusted platform data. Unknown platforms use a device mark; recognized Linux distributions use brand marks, otherwise Tux. Keep the slot fixed.

# Boundaries

[Environment library](desktop-environment-library.md) owns grouping, grids and counts; this contract owns presentation.

# Evidence

- `redeven:desktop/scripts/check-environment-card-tabs.mjs` - Ten locales, themes, text scaling, tabs, alignment, focus and busy states.
