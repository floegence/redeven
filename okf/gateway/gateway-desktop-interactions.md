---
type: Interaction Contract
title: Gateway Desktop interactions
description: Manage registered Gateway environments in place with clear counts, contextual forms, explicit access actions and shared operation feedback.
tags: [gateway, desktop, interaction, validation]
timestamp: 2026-10-05T00:00:00Z
---
# Summary

This concept owns Desktop Gateway card presentation and interaction. Users can
understand the registered-environment count and add, inspect, edit, delete or
open an environment without leaving the Gateway page. Cards consume the existing
launcher snapshot and action model; they never own a second profile store or
Runtime lifecycle authority. Failed writes retain the draft for explicit retry,
and failed refreshes distinguish retained data from a synchronized empty list.
[Gateway service](gateway-service.md) owns process management and permission
boundaries; [Gateway access sessions](gateway-access-sessions.md) owns transport,
Runtime login and revocation.

# Contract

## Card information hierarchy

Each Gateway occupies one full-width row at every viewport size. It shares the
Redeven Cloud overview surface, identity spacing, action grouping and subtle
status strip. The main row contains the dedicated Gateway mark, name and
connection, registered-environment count, Add environment, current service or
refresh action, and one secondary-actions menu. Narrow layouts reflow whole
controls while keeping every label on one line. The status strip separates
Gateway connectivity and trust from catalog guidance; no target-health metrics
are invented to resemble Cloud statistics.

The count includes a localized environment unit and a quieter Added label,
never a filesystem-directory label or online-environment count. Its disclosure
expands the existing environment list below the status strip. Its help explains
registration and reachability without changing permission. Empty and failed
refresh guidance lives in the status strip rather than adding a tall card body.
The list contains explicitly registered targets;
Gateway does not scan the network or discover Runtime installations. An unknown
directory count is distinct from a successfully synchronized empty directory.
Catalog entries do not assert target reachability or Runtime health.

## Contextual environment management

Add environment opens the existing URL-profile form over the current Gateway
page with this Gateway fixed and Gateway proxy as the default. The contextual
form omits unrelated connection types and gateway selection, retains its draft
on failure, and closes after a successful save. Cancel preserves the page's
query, filter, scroll position and originating control. Save refreshes the same
authoritative launcher snapshot and reveals the updated count and list.
View environments expands full-width environment rows inside the card. Names, target URLs and
default access methods remain inspectable there, with explicit direct/proxy
actions drawn from the shared environment action model. Open uses the card's
existing foreground progress owner; edit and delete use the existing settings
and confirmation workflows. Neither operation navigates to another tab or
creates a second profile store. Successful writes update the list in place;
failed writes retain the form or confirmation for an explicit retry. The
general New Environment entry still offers all connection types. When a
successful deletion removes its trigger row, focus returns to the owning
Gateway's Add environment control after the confirmation closes. Cancel keeps
the ordinary return to the original row control.

Routine Refresh is visually secondary to adding and accessing environments;
required service actions and active progress retain their existing prominence.
A single-Gateway page omits redundant source filter pills. These presentation
choices grant no Runtime lifecycle authority. A paired client without profile-write permission receives an
Authorize changes entry into Gateway setup instead of an implicit grant.

## Permission explanation

The profile-write checkbox has a keyboard-accessible question button. Its
click-expanded body explains names, Runtime URLs, default access methods, and
visibility to other paired Desktops after refresh. It also explains that Runtime
password, MFA, settings, and lifecycle permissions remain independent. Reading
this help never changes consent or submits a request.

## Operation progress

Gateway actions use the existing launcher operation as the single progress
owner. Managed service events project into its step timeline, retaining the
active phase and elapsed time on failure. Because installation and host phases
can be skipped or revisited, service progress shows observed steps without an
invented percentage or fixed step total. The shared meter stays visible: it
animates indeterminately during service work, fills on success, and stops on
failure or cancellation. Total elapsed time comes from the operation's main-process
start timestamp, survives stage changes and popover reopening, and freezes at the
terminal snapshot timestamp. The separate current-stage timer remains a waiting
hint. Primary-button labels identify the actual start, stop, restart, or update
operation, including its failure. A single click submits an action once;
the busy primary button uses the shared progress shimmer and reopens that same
operation. Its action icon and admission spinner share the published Button icon
slot, so pending requests never display both. Dismissing the popover does not
cancel or resubmit work. The main-row action anchor uses the existing automatic popover placement to
keep progress inside the viewport. Popovers and menus retain a noninteractive exit frame, restore trigger focus on Escape, and
respect reduced-motion preferences.

# Boundaries

The Gateway page shows explicit registrations, not network discovery or a health
monitor. Direct and proxy access remain explicit actions from the same shared
model as the environment library. Service and profile permissions remain owned
by the linked Gateway contracts. Renderer fixtures establish interaction only;
real network and installed-package qualification remains separate.

# Validation

`node desktop/scripts/check-gateway-access-ui.mjs` covers
all ten locales at 1280, 760 and 430-pixel widths, including dark and large-text layouts, including the
explicit Start-and-retry setup continuation, card-to-profile Gateway selection,
and profile permission help without changing consent.
Adding from a card must retain the Gateway tab, lock the originating Gateway,
omit unrelated connection types, and restore keyboard focus on cancellation.

Run `node desktop/scripts/check-gateway-environment-flow.mjs` for the contextual
profile workflow. It exercises empty state, failed Save with retained draft,
explicit retry, refreshed count and expanded list, editing, confirmed deletion,
and retained stale-list feedback at light/dark desktop and 430-pixel large-text
layouts. It uses production renderer components and isolated IPC fixtures;
reports and screenshots live in `desktop/dist/gateway-environment-flow/`.

Run `node desktop/scripts/check-gateway-card-experience.mjs` for the focused
Welcome interaction qualification. It renders production components with owned
launcher fixtures at desktop and 430-pixel widths, with light/dark themes and
large text. It asserts that every Gateway fills its own row, then checks single-click
submission, delayed service progress, shared
button shimmer, popup and menu entry/exit, keyboard navigation and focus return,
failure presentation, and dismissal/reopening without canceling or resubmitting.
The update confirmation leads into the same progress popup with a visible
indeterminate meter and total elapsed time. Advancing the fixture clock verifies
that elapsed time survives stage changes and reopening, then freezes on failure.
The ten-locale access UI runner also checks progress layout and reduced motion.
The update-required snapshot also covers an update already running before any
card-local interaction. Both admission and background updates must show exactly
one primary-button icon. Environment-count help and the header settings menu remain
keyboard accessible in the full-width overview layout.
The progress fixture uses the production service-step projection. Screenshots
and its report live in `desktop/dist/gateway-card-experience/`. This establishes
renderer behavior; real service deployment remains owned by
[Gateway deployment qualification](gateway-deployment-qualification.md).

The shared shell also runs the existing Cloud overview browser check to verify
account counts, responsive controls, recovery details and sign-out remain intact.

# Evidence

- `redeven:desktop/src/welcome/App.tsx` - Contextual forms, Gateway cards and shared launcher operations.
- `redeven:desktop/src/welcome/GatewayEnvironmentList.tsx` - Inline registered targets and shared explicit access actions.
- `redeven:desktop/src/welcome/GatewaySetup.client.test.tsx` - In-place creation, cancellation, retained drafts and explicit access requests.
- `redeven:desktop/src/main/gatewayServiceProgress.test.ts` - Observed phases, repeated-phase timing and terminal progress.
- `redeven:desktop/scripts/check-gateway-access-ui.mjs` - Ten-locale access, contextual creation, consent help and setup recovery.
- `redeven:desktop/scripts/check-gateway-card-experience.mjs` - Service progress, motion, single-icon actions and keyboard navigation.
- `redeven:desktop/scripts/check-gateway-environment-flow.mjs` - Creation, failed-save retry, editing, deletion, focus and count reconciliation.
- `redeven:desktop/scripts/check-cloud-account-overview.mjs` - Regression coverage for the shared Cloud overview shell.
