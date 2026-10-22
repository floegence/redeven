---
type: Interaction Contract
title: Managed Service version interaction
description: Select and verify a version in one drawer, confirm only changed notices, and stop or submit without losing context.
tags: [architecture, web-services, releases, updates, ui]
timestamp: 2026-09-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Redeven owns version selection and presentation; the Manager owns the exact update plan and operation admission.
- Outcome: an ordinary update takes a version selection and one explicit submit action in the same drawer.
- Invariants: preparation never executes an operation; only new or revised required template notices need confirmation; the selected version and browsing context survive preparation and admission failure; one local viewport owns scrolling.
- Failure boundary: source or admission failures stay actionable in the drawer; accepted operations continue through the existing service operation controller when the drawer closes.

# Contract

## Selection and automatic preparation
The service row's installed version opens the version drawer. The UI never selects the first source result automatically.

The footer links directly to any outstanding confirmation.

## Layout and accessibility
The header identifies the service and current version. They never precede the version list or push earlier rows down.

Restored candidates stay visible during refresh.

## Stop, submit, and recover
Downgrades and unknown-order switches use the Manager's existing stopped-state requirement.

[Operation progress](managed-service-operation-progress.md) owns observation, completion, failure retention, and controller cleanup; the drawer adds no polling or parallel progress owner.

Browser acceptance must inspect screenshots of wide and narrow layouts in light and dark themes, plus required notices, stopped-state guidance, preparation, rejection, and long translated version labels. Screenshots supplement assertions and must be opened and visually reviewed before delivery.

# Boundaries

Redeven owns candidate selection, drawer presentation, and explicit submit intent. Preparation never executes an update or creates another operation lifecycle.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Owns selection, compact presentation, inline notices, stop and admission handling.

- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceUpdatePreparation.ts` - Serializes and invalidates preparation independently of candidate discovery.

- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceUpdatePreparation.test.ts` - Covers rapid selection, session changes, expiry, and explicit retry.
