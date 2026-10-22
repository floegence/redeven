---
type: Desktop Contract
title: Desktop environment settings presentation
description: Apply one theme-aware visual hierarchy, fixed window geometry and responsive controls across settings tasks.
tags: [desktop, settings, interaction, themes]
timestamp: 2026-10-12T06:30:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop composes released Floe Dialog, Tabs, controls and floating presence into
one consistent Environment settings surface. Theme tokens own material and
contrast; product styles own grouping, spacing and responsive geometry. Every
settings page retains readable labels, reachable actions and a fixed window
viewport. Loading, failed operations and expanded disclosures cannot replace
the draft owner or resize the window. The
[settings session contract](desktop-environment-settings.md) owns authority,
persistence, prerequisites and recovery; presentation adds no operation state.

Interaction sessions follow [Desktop interaction continuity](desktop-interaction-continuity.md), including authority invalidation, retained drafts, explicit visibility and stale-completion fencing.

# Contract

## Window and section hierarchy
The panel is at most 50rem (800px) wide and has a stable 44.375rem (710px) height capped by the available viewport and Desktop titlebar. Viewport resizing may change the cap; expanding fields, loading settings, showing certificates or switching tabs must not resize or recenter the window or move its action baseline.

Product styles must not erase a published outline button's boundary or disable its hover/focus affordances merely to make an action resemble text.

## Connection facts and forms
Current connection is one settings card. Address headers must not alternate between a different reading edge and a separate outer card.

Text, diagnostics, paths and addresses remain selectable and wrap within their owner.

## Access tasks and workflows
The access overview presents browser scope, sign-in protection and certificate tasks as matching rows with meaningful icons and published outline management buttons. Appearance must not turn an uncommitted removal draft into an already-removed password state.

QR pairing and recovery-code grids retain their specialized geometry; verification and recovery semantics belong to the settings session contract.

## Actions, responsive layout and focus
Footers keep feedback separate from the action group. Review never contains a password value.

Floe owns focus trapping, nested Escape, restoration, control variants and forced-colors behavior.

## Motion within the fixed viewport
Floe owns modal entry/exit and the active tab's 200ms underline. Retained exit cannot blank the closing panel.

Visual transitions add no lifecycle owner.

# Boundaries

The [settings session contract](desktop-environment-settings.md) owns registration authority, secret handling, prerequisites and recovery. Styling adds no modal, focus manager or persistence path.

# Evidence

- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.css` - Shared theme material, fields, target sizes and responsive geometry.

- `redeven:desktop/src/welcome/EnvironmentAccessWorkflow.css` - Connection grouping, access tasks, password and workflow hierarchy.

- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.tsx` - Released Dialog, retained panels and fixed scrolling/actions.
