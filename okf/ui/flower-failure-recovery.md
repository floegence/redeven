---
type: UI Contract
title: Flower failure recovery
description: One turn-level failure owner and bounded manual recovery without replaying uncertain effects.
tags: [ai, flower, recovery, interaction]
timestamp: 2026-10-15T00:00:00Z
---
# Summary

Floret owns canonical execution outcomes and retry checkpoints. Flower keeps
accepted messages readable and provides one turn-level failure and recovery
surface. Navigation, settings exit, drafts and queue editing remain available.
Transport uncertainty never proves backend success or authorizes replay.

# Contract

Provider failures expose Configure current provider, Retry reply and diagnostics.
Typed model-request timeouts use localized recovery copy and the same actions;
[request deadlines and automatic recovery](../ai/model-provider-surface-and-history.md)
remain upstream-owned. Configuration opens the current provider and model directly. Cancel and successful
save return to the originating chat; saving does not retry automatically. Save
errors retain the dialog and draft, pending actions prevent duplicate dispatch,
and retry failures leave another deliberate attempt available. Navigating to a
different chat cannot be undone by a late save. A deleted provider leaves a clear
settings error and the ordinary back/navigation controls. Saving keeps a Close
control available with an explicit notice that the request continues. Closing
invalidates only that dialog's completion target. Both settings entrypoints use
one bounded request deadline; timeout releases controls without replaying a mutation
or claiming rollback. Reopening Flower settings refreshes canonical configuration
before another deliberate attempt. Unknown tool effects retain their no-retry
boundary. Manual retry uses the same deadline without dispatching another
command automatically.

Manual retry first reads canonical thread detail and proceeds only while the
selected thread is still failed. Historical typed engine failures expose the
same action; unknown effect outcomes never do. Floret validates the checkpoint
and owns reuse of confirmed tool results. A failed or timed-out retry releases
the button without starting queued work; another attempt confirms current
state before dispatch. Navigation, settings exit and drafts remain available.

Accepted user input and retained assistant output keep normal message styling
when a turn fails. The turn owns one failure notice and its recovery actions;
message bubbles never repeat that notice. Empty failed output uses the same
turn-level fallback. Unadmitted send failures remain in the transport outbox
with their existing draft and retry controls.

Stop uses a 120-second request deadline and a 15-second canonical detail read.
Timeout releases request ownership, keeps navigation and drafts usable, and
provides an unconfirmed-status notice with Resync. It does not resend or claim
that cancellation succeeded. Another manual attempt first reads canonical state.
Late results obey existing connection epoch, version and thread-selection guards.

# Boundaries

Floret validates retry checkpoints and confirmed tool results. The host never
patches journal records, infers recovery from error prose, replays uncertain
effects or starts queued work after failure. SSH access and remote runtime
operations remain separate from conversation recovery.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Shared failure, Stop and manual recovery actions.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Canonical item status projection.
- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - One timeline failure owner.
- `redeven:internal/flower_ui/src/requestDeadline.ts` - Bounded mutation deadline.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.liveRecovery.test.tsx` - Stop and detail recovery.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx` - Pause tokens, available Stop/navigation, terminal cleanup and safe retry at narrow and desktop widths.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.providerRecovery.browser.test.tsx` - Provider and historical recovery.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Navigation and accepted message rendering.
