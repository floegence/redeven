---
type: Interaction Contract
title: Managed Service version interaction
tags: [architecture, web-services, releases, updates, ui]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven owns version selection; Manager owns exact update-plan admission. Users select and submit in one drawer. Preparation executes nothing, only changed required notices need confirmation, and selection/browsing survives preparation or admission failure. Accepted operations retain their existing controller after drawer closure; source failures stay actionable in place.

# Contract

- Installed version opens the drawer; never auto-select the first result. Keep service/current-version header, restored candidates during refresh and one scrolling viewport. Notices stay below the list without shifting prior rows; footer links to outstanding confirmation.
- Downgrades/unknown ordering follow Manager stopped-state requirements. [Operation progress](managed-service-operation-progress.md) owns completion/failure/cleanup without drawer polling or another lifecycle.
- Browser qualification visually reviews light/dark wide/narrow screenshots with notices, stop guidance, preparation/rejection and long translations; screenshots supplement assertions.

# Boundaries

Only explicit submit requests execution. Selection, preparation and closing a drawer cannot create or cancel a backend lifecycle implicitly.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Owns selection, compact presentation, inline notices, stop and admission handling.

- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceUpdatePreparation.test.ts` - Covers rapid selection, session changes, expiry, and explicit retry.
