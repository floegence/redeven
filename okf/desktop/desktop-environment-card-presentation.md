---
type: Interaction Contract
title: Environment card presentation
description: Preserve compact Env card tabs, facts, action footers, focus and geometry across snapshots.
tags: [desktop, environment, interaction, accessibility]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The shared Environment card renders independent access perspectives with its existing tabs, facts and split footer. Perspective changes select an explicit route and never grant authority or fall back after failure. Snapshot refresh preserves nodes, selection, drafts and focus; removing an owner invalidates submission while preserving its open sessions. Long translations and narrow layouts retain single-line controls and stable card geometry. A locally bundled OS mark in its original brand colors beside the Runtime name displays a trusted platform fact; unknown platforms show a default device illustration in the same fixed slot.

# Contract

Interaction sessions follow [Desktop interaction continuity](desktop-interaction-continuity.md), including authority invalidation, retained drafts, explicit visibility and stale-completion fencing.

Recognized Linux distributions use their original brand marks; missing or unsupported IDs retain Tux.

## Perspectives and owner actions
Linked cards expose Runtime, Redeven Cloud and any paired Gateway as tabs in the existing compact segmented selector in the same header slot used by standalone type badges.

Cloud authorization or synchronization failure never disables Runtime actions.

Deliberate Environment Center tab selection follows the separate [Welcome navigation presentation contract](desktop-welcome-navigation.md); its transient visual translation does not change card layout or restart on snapshots.

# Boundaries

[Environment library](desktop-environment-library.md) owns identity grouping, source grids and counts. This concept owns card presentation and interaction continuity, without changing those authorities.

# Evidence

- `redeven:desktop/scripts/check-environment-card-tabs.mjs` - Two- and three-option readability, five-column layout, native pointer selection suppression, keyboard switching and snapshot focus across ten locales, light/dark themes and enlarged text.

- `redeven:desktop/src/welcome/EnvironmentCards.tsx` - Shared cards, stable perspectives, owner action and overlay control.

- `redeven:desktop/src/welcome/CloudConnectionStatus.tsx` - Independent local and Cloud state, actionable recovery and scoped diagnostics.
