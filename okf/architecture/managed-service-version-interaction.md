---
type: Interaction Contract
title: Managed Service version interaction
tags: [architecture, web-services, releases, updates, ui]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven presents one version-selection/submission drawer; Manager admits exact update plans. Preparation executes nothing; changed notices require consent. Failed preparation retains browsing/selection. Accepted work outlives drawer, with source failures actionable in place.

# Contract

- Installed version opens the drawer; never auto-select the first result. Keep service/current-version header, restored candidates during refresh and one scrolling viewport. Notices stay below the list without shifting prior rows; footer links to outstanding confirmation.
- Downgrades/unknown ordering follow Manager stopped-state requirements. [Operation progress](managed-service-operation-progress.md) owns completion/failure/cleanup without drawer polling or another lifecycle.
- Browser qualification visually reviews light/dark wide/narrow screenshots with notices, stop guidance, preparation/rejection and long translations; screenshots supplement assertions.

# Boundaries

Only explicit submit requests execution. Selection, preparation and closing a drawer cannot create or cancel a backend lifecycle implicitly.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceUpdatePreparation.test.ts` - Tests.
