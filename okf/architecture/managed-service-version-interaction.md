---
type: Interaction Contract
title: Managed Service version interaction
description: Select and verify a version in one drawer, confirm only changed notices, and stop or submit without losing context.
tags: [architecture, web-services, releases, updates, ui]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

- Authority: Redeven owns version selection and presentation; the Manager owns the exact update plan and operation admission.
- Outcome: an ordinary update takes a version selection and one explicit submit action in the same drawer.
- Invariants: preparation never executes an operation; only new or revised required template notices need confirmation; the selected version and browsing context survive preparation and admission failure; one local viewport owns scrolling.
- Failure boundary: source or admission failures stay actionable in the drawer; accepted operations continue through the existing service operation controller when the drawer closes.

# Contract

## Selection and automatic preparation

The service row's installed version opens the version drawer. No replacement release is selected by default; new deployments still default to the verified recommendation. The UI never selects the first source result automatically. Candidate ordering, exact identities, advisory risks, and backend validity are owned by [release discovery and updates](managed-service-release-discovery.md).

A pending candidate immediately records user intent with radio semantics. Its exact platform check has priority over queued visible checks without aborting another active check. Until the selected identity is verified and an update plan is prepared, the primary action stays disabled with an explicit verification label. Completion of an earlier candidate check must not change the user's later selection.

A verified, different release automatically prepares a plan. Preparation uses a separate request lifetime from candidate listing, paging, and verification. Rapid choices are coalesced and preparation requests are serialized; generation checks reject stale selection, closed-session, and cross-service responses. Updating unrelated candidate rows does not discard the plan or notice confirmations. Plan expiry triggers preparation again without executing an operation. Failed preparation requires explicit retry.

There is no separate plan page or review button. Version risks remain advisory. The backend returns the service's previously saved exact notice revisions; those do not create checkbox gates. Required new or revised notices are expanded in the same scroll region. In-session confirmations are keyed by notice ID and revision and survive selecting another version of the same service. Closing or switching services clears them. The footer links directly to any outstanding confirmation.

## Layout and accessibility

The header identifies the service and current version. Search and channel filters stay outside the local scroll viewport. Notices, advisory explanations, and optional version details appear directly beneath the selected version, inside its selection highlight. They never precede the version list or push earlier rows down. The selected row and its explanation share one local scroll viewport with the other candidates; there is no nested scrolling body. Notices use inline titles and descriptions instead of stacked cards, while advisory explanations use a quiet list. Required acknowledgements stay explicit. If filtering hides the selection, its labeled explanation remains below the filtered results, and the footer link scrolls to and focuses the first unchecked acknowledgement without resetting the filter.

Version identity remains primary, redundant stable/latest and preview/latest-preview badges are suppressed, and source, platform, artifact identity, and check time are disclosed as details. The fixed footer shows current-to-target identity, operation impact, and one primary action. A long version identifier can truncate visually while retaining its full accessible text and title. On narrow screens the primary action occupies a full row below Refresh and Cancel so translated action labels remain readable.

The primary action names the target and distinguishes an update, downgrade, unordered switch, and moved-tag image replacement. Running-service updates disclose temporary unavailability. Stopped-service updates disclose that verification finishes with the service still stopped. Downgrades explain that application data is not reverse-migrated.

The outer body never scrolls. Mouse, trackpad, touch, and keyboard scrolling stay in the shared Workbench-marked viewport. Radio choices support arrow keys, Home, and End; these shortcuts do not intercept keyboard input in the inline acknowledgements or details. Overlay dismissal, Close, Escape, and Cancel remain available during source loading and preparation. Closing aborts preparation, not an already submitted lifecycle operation. Focus styling, floating placement, and global-dialog input isolation remain owned by published Floe components. A global drawer opened from Workbench owns its pointer sequence, including footer actions, and must never start canvas pan or zoom.

The request-status band has a fixed height outside the candidate viewport. It distinguishes initial loading, refresh, next-page loading, queued verification, and active verification. Busy feedback includes readable text, a rotating indicator, and an indeterminate track; reduced motion keeps the text and static indicator. Successful brief source requests remain visible for at least 280 milliseconds, while failures replace them immediately. Idle feedback reports loaded count or a next-page hint without claiming offscreen candidates are verified. Restored candidates stay visible during refresh.

## Stop, submit, and recover

Downgrades and unknown-order switches use the Manager's existing stopped-state requirement. The drawer reads current service state, not its opening snapshot. When necessary the primary action says "Stop service and continue" and stops the service in place using the existing operation controller. The accompanying explanation states that the user confirms the version switch here after stopping. Successful stopping preserves the selection and changes the primary action to the target version; it never automatically submits the update. Failed stopping remains visible and cannot proceed to version replacement.

The explicit update click submits the exact current plan once. Repeated submission is disabled while awaiting admission. Rejection keeps the drawer, chosen version, and still-valid confirmations available with a localized inline error. Expired plans, changed targets, or changed notices prepare again and require another explicit submit. Accepted updates close the drawer and transfer presentation to the service row. [Operation progress](managed-service-operation-progress.md) owns observation, completion, failure retention, and controller cleanup; the drawer adds no polling or parallel progress owner.

# Boundaries

Redeven owns candidate selection, drawer presentation, and explicit submit intent.
The Manager owns exact update plans and operation admission; the existing service
operation controller owns execution and progress after admission. Preparation
never executes an update or creates another operation lifecycle.

# Validation

Browser acceptance must inspect screenshots of wide and narrow layouts in light and dark themes, plus required notices, stopped-state guidance, preparation, rejection, and long translated version labels. Verify one scroll owner, reachable actions, keyboard selection, and retained context. A real projected Workbench fixture must exercise local wheel scrolling and pointer submission while preserving the canvas viewport. Screenshots supplement assertions and must be opened and visually reviewed before delivery.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Owns selection, compact presentation, inline notices, stop and admission handling.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceUpdatePreparation.ts` - Serializes and invalidates preparation independently of candidate discovery.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceUpdatePreparation.test.ts` - Covers rapid selection, session changes, expiry, and explicit retry.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceVersions.browser.test.tsx` - Exercises the production drawer in Chromium and captures the required presentation states.
