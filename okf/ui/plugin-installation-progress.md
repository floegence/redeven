---
type: UI Contract
title: Official installation progress
description: Observe durable official installation without coupling it to a management page or saved placement.
tags: [ui, plugins, review, lifecycle]
timestamp: 2026-09-08T00:00:00Z
---
# Summary

ReDevPlugin owns the durable official-install Execution and its progress, idempotency, and recovery. Redeven observes that authority, presents exact market review and permission setup, and retains the operation when management closes. Response loss never creates a second installation. Only current authoritative inventory can expose a launch target; failed setup cannot revive stale permissions or remove saved canvas components.

# Contract

## Official installation progress

The pre-install interaction has one target-owned flow: `idle`, `review_ready`,
`installing`, then `installed`; task failure is owned only by the shared install
projection. A card or detail click opens the dialog in the same UI turn and
reads the market-cached `install_preview`; no package request or Host inspection
is started. The concise review shows only icon, name, publisher, version, source,
and grouped declared permissions, followed by `The publisher declares these
permissions; they will be verified during installation.`

The preview identity includes the plugin instance, market generation, complete
release reference, release-identity digest, manifest digest, contract-set digest,
and summary digest. A changed target is stale and requires market refresh; stale
completion cannot open another plugin's dialog. Confirmation submits exactly that
identity and keeps the existing default-enable Host path.

Confirmed uninstall removes the exact instance's canvas placements, regardless of
plugin-data retention. A failed or unresolved uninstall preserves them until
Host inventory confirms absence. A later install is resolved through current
Host inventory and required permission setup; old surface authority is never
revived from a locally remembered revision.
Each completed Execution's
post-install setup commits at most once in the current Shell; recovery may
finish only required permissions that have no durable prior decision and never
re-enables a user-disabled plugin or restores a denied, revoked, or expired
grant. Inventory retains every current durable Host permission decision,
including denied, revoked, and expired records, while deriving current grant
state from effect, revocation, and expiry. The current authoritative launch
target is openable immediately only after that bounded setup succeeds; failed,
superseded, or incomplete reinstalls cannot revive a stale surface.

Official installation uses the released durable Execution instead of a
page-bound pending flag. The dialog shows four fixed steps: `download`, `verify`,
`install`, and `enable`, with completed, running, pending, or failed state. A
total progress bar advances by stage; download may show byte progress, while
verification, install, and enable remain indeterminate. Search, filters, scrolling,
detail reading, panel close, and unrelated surface launch stay available while
installation continues. Closing the dialog only hides it; the card or task area
retains the current stage and one recovery action.

Directory cards keep a fixed identity, two-line author summary, metadata, and
action footprint across installation states. A same-name summary is omitted
without substituting host-authored plugin copy. Uninstalled cards omit the
redundant availability badge; source/trust evidence remains independent of
lifecycle status. Category selection uses the same filter menu contract as
source, trust, and lifecycle, with view tabs outside the filter scroll area.
An installation summary replaces the card action row and opens the existing
inspector for the complete timeline. Only authoritative download byte totals
produce a percentage; other stages use a four-segment indicator that distinguishes
completed stages from the current stage. Reconnection and finalization remain
busy. Successful observation restores the projected primary action; failures
retain their exact recovery action and full explanation in details. The card
stays in place while an inspector or review dialog owns live announcements.
No cancel control is exposed for the platform's noncancelable install Execution.

The Shell has one observer per plugin attempt and retains the original request
identity. It reattaches to the same Host Execution after Plugin Center reopens or
transport reconnects. A lost start response replays the exact reviewed command
with the same request id; it does not start a competing poller. Closing the panel
never cancels installation. Terminal failures use the released error code, stage,
and `retryable` fact to produce one message and one action; raw backend messages
are not primary UI and cards, details, dialogs, and notifications do not repeat
live error announcements. A retry creates a new request only when the Host has confirmed a
retryable terminal failure. If the exact reviewed command is unavailable after a
restart, the only action is a fresh review. After success, inventory is
refreshed before the temporary status is removed. Refresh failure remains a
separate inline recovery state and must not be reported as installation failure.
The startup observer waits for that inventory before resolving durable plugin
identities. A confirmed historical-data erase keeps the exact binding revision;
absence on retry means the prior delete committed, while a changed revision
requires a new confirmation. Opening the erase dialog transfers the sole error
presentation into that dialog.
Cards and inspector share the same accessible `aria-busy`, live-status, alert,
and progress projection.

# Boundaries

[Plugin surfaces](plugin-surfaces.md) owns discovery and management navigation.
[Plugin layout continuity](plugin-layout-continuity.md) owns container persistence.
Package, trust, execution, and permission authority remain in released ReDevPlugin;
these UI workflows cannot add a parser, mutation receipt store, or permission grant.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Presents review and installation state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInstallCoordinator.ts:1` - Retains and resumes authoritative Execution observation.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApprovedInstallSetup.ts:1` - Completes only permitted post-install setup.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInstallCoordinator.test.ts:1` - Covers observer and response-loss behavior.
