---
type: UI Contract
title: Flower failure recovery
description: One turn-level failure owner and bounded manual recovery without replaying uncertain effects.
tags: [ai, flower, recovery, interaction]
timestamp: 2026-10-16T00:00:00Z
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

Known loop failures use the published canonical typed reason in both live and
historical projections, including after restart. Repeated tool requests,
no-progress polling, duplicate call identities and stop-hook loops have explicit
localized causes. Unrecognized errors retain their typed category without a
speculative explanation. Details include only allowed reason codes and canonical
ThreadID/TurnID/RunID; raw requests, arguments, credentials and upstream error
bodies never cross this boundary. A previous declined tool cannot hide a later
independent failure.

Root and child failure cards share target-specific recovery. Child provider
configuration opens the shared chat reader for that child before resolving its
actual model settings, retains Return to parent, and ignores superseded reads.
Preflight, retry
and compaction use the card's ThreadID, request deadline, connection epoch and
selection guard; every exit releases busy state. Compaction uses the existing
transport outbox and reuses its request identity after uncertain delivery. A
child's pending command remains recoverable in its detail window. Confirmed
results and completed reports remain with the canonical checkpoint. Unknown
effects offer no retry and direct the user to verify actual effects before new
work. Child attention uses the same full chat interaction controls and an
explicit return-to-parent action; resolving it never resumes the parent itself.

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

The selected child stays in the existing bounded detail cache across a root-only
workspace reconnect baseline, then the normal detail reader revalidates it.
Parent-routed child updates feed that same selected detail; no second stream or
poller is opened. Return to parent remains available after load failures.
Compaction delivery uses the shared outbox recovery actions: unknown delivery
retains its request identity for deliberate retry, and storage-restored requests
provide refresh and removal before a new command. Full child reports bypass the
ordinary tool preview limit while retaining the provider request budget; canonical
retry therefore reuses the complete confirmed reports without dispatching tools.

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

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.boundedWait.test.shared.tsx` - Child input/approval, explicit parent continuation, target-specific retry, compaction delivery and reconnect coverage.
- `redeven:internal/ai/subagents_wait_test.go` - Typed wait mapping and complete four-report canonical retry without tool redispatch.
