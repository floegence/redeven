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

The shared Environment card renders independent access perspectives with its existing tabs, facts and split footer. Perspective changes select an explicit route and never grant authority or fall back after failure. Snapshot refresh preserves nodes, selection, drafts and focus; removing an owner invalidates submission while preserving its open sessions. Long translations and narrow layouts retain single-line controls and stable card geometry. A locally bundled OS mark in its original brand colors beside the Runtime name displays a trusted platform fact; unknown platforms show a default device illustration in the same fixed slot.

# Contract

Interaction sessions follow [Desktop interaction continuity](desktop-interaction-continuity.md), including authority invalidation, retained drafts, explicit visibility and stale-completion fencing.

Recognized Linux distributions use their original brand marks; missing or unsupported IDs retain Tux.

## Window action language
User-facing copy describes the visible action and destination. An unopened Environment offers **Open window**; an existing window offers **Show window** and focuses that session. Local, SSH, Cloud and Gateway perspectives use the same localized action wording. The selected perspective identifies the access route. These labels do not change runtime readiness, authorization, lifecycle or session ownership.

Settings, progress, recovery guidance and browser titles use Environment, environment window or Redeven as appropriate. The internal name Env App remains an implementation term, never a product label or protected brand term. All shipped Desktop and environment catalogs explicitly translate this copy; catalog regression checks reject the internal name in displayed messages.

## Primary action alignment
The split footer centers visible content within the primary button, independently of the menu toggle. Text-only actions reserve no invisible icon space. Submission adds a visible loading indicator and surface shimmer, exposes the busy state, and blocks duplicate activation without changing button geometry. Completion restores the centered text-only action. Meaningful action and progress icons stay grouped with their labels.

## Perspectives and owner actions
Linked cards expose Runtime, Redeven Cloud and any paired Gateway as tabs in the existing compact segmented selector in the same header slot used by standalone type badges.

Cloud authorization or synchronization failure never disables Runtime actions.

Deliberate Environment Center tab selection follows the separate [Welcome navigation presentation contract](desktop-welcome-navigation.md); its transient visual translation does not change card layout or restart on snapshots.

# Boundaries

[Environment library](desktop-environment-library.md) owns identity grouping, source grids and counts. This concept owns card presentation and interaction continuity, without changing those authorities.

# Evidence

- `redeven:desktop/scripts/check-environment-card-tabs.mjs` - Two- and three-option readability, five-column layout, centered primary actions, native pointer selection suppression, keyboard switching and snapshot focus across ten locales, light/dark themes and enlarged text; submission retains button geometry and accessible busy feedback.

- `redeven:desktop/src/welcome/EnvironmentCards.tsx` - Shared cards, stable perspectives, owner action and overlay control.

- `redeven:desktop/src/welcome/CloudConnectionStatus.tsx` - Independent local and Cloud state, actionable recovery and scoped diagnostics.

- `redeven:desktop/src/shared/i18n/desktopI18n.test.ts` and `redeven:internal/envapp/ui_src/src/ui/i18n/i18n.test.ts` - Every shipped locale excludes the internal app name from user-facing messages.

- `redeven:desktop/src/welcome/EnvironmentRelation.client.test.tsx` - Window actions retain explicit access routes, focus existing sessions and preserve card state across snapshots.
