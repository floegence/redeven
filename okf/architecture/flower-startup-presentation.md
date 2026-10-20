---
type: Interaction Contract
title: Flower startup and recovery presentation
description: Keep navigation and drafts available while the single readiness owner prepares, stops or restores Flower.
tags: [flower, startup, readiness, recovery, ui]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Env App and Desktop render canonical readiness facts and explicit safe recovery actions.
The single readiness owner controls Flower admission while navigation and shell-owned
drafts remain available. No surface starts another availability controller. Stop and
retry follow typed safety facts; a close failure requires application restart, and
unknown or contradictory facts expose a non-retryable contract failure.

# Contract

Env App shares one readiness controller across Activity, Workbench, and
Settings. Its snapshot is the only admission boundary for the Flower product
subtree: `ready` and `degraded` mount one surface, while every other state leaves
the surface unmounted and shows maintenance in its slot. Unmounting stops the
workspace stream, invalidates unfinished bootstrap work, and discards local
errors and caches. Returning to an operational state creates one clean surface
from server data. The Shell-owned composer draft coordinator stays outside this
boundary, so unsent drafts survive. No Flower-local readiness state machine,
poller, or 503 suppression path exists.

Within that readiness boundary, one adapter and Surface share an authenticated
environment lifetime. Environment object refresh, display-name changes, locale,
layout and resource-request generations do not replace the adapter. Display and
permission getters stay live. Unconfirmed, failed or revoked permissions cannot
authorize new mutations; renewed authority reopens the same controls. Access
regrant and readiness recovery preserve drafts, references and attachment state.
A different environment, access source or confirmed authenticated user ends the
old lifetime and clears its draft scopes rather than transferring attachment
authority. Request generations invalidate reads, never define user identity.

Settings have one read owner and explicit loading, ready and error states. Initial
load, external revision, opening settings and manual Retry enter that same path.
Configuration and personal preferences must both complete within the existing
15-second deadline. A settings-version/resource-generation tuple prevents
revision collisions. Only the current adapter and read generation may publish
success or failure. Supersession and unmount release pending reads and subscriptions;
old completions cannot clear current errors or loading. No completion recursively
starts another read.

Until the current revision is confirmed, the draft and history remain usable,
while settings-dependent sending and preference editing stay disabled through
buttons, Enter, shortcuts and commands. Existing snapshots remain visible but
cannot authorize sending. Failure exposes the same accessible Retry in full,
companion, embedded and settings presentations, including a collapsed companion.
Shell uses the confirmed authenticated cache scope independently of its persistent
or live-only storage owner to detect user changes. Revalidation keeps the last
confirmed identity while blocking unconfirmed operations.

Recovery never sends or takes focus automatically. Settings can always close;
Stop, approval and preparation cancellation retain their independent authority.
History refresh, selection and Turn acceptance cannot clear settings failure.
Collapsed companion recovery shares the same status, keeps Retry inside its
compact frame, and retains the visible editor and independently authorized Stop.

The boundary never disables or hides the shell, Workbench, terminal, files,
Settings, or a shared ancestor. Only the visible Flower placement may move or
restore focus.

Readiness status reads share Flower's 15-second read deadline; Prepare and Stop
share its 120-second command response deadline. Timeout releases loading and
single-flight ownership, preserves drafts and offers Refresh to read the actual
backend status. A lost response never proves cancellation or safe retry. Late
responses cannot overwrite a later refresh, paused workspace or new generation.
Only typed backend safety enables a subsequent mutation.

Env App begins readiness inspection only after the HTTP access status has been
checked and access is granted. The readiness HTTP route remains available while
the encrypted direct RPC transport connects, resumes, or reconnects, so
readiness refresh must not wait for RPC or access-resume UI state. Initial lock
and every later grant revocation pause the controller, invalidate in-flight
publication, clear polling and automatic retry state, and reject manual refresh
or retry without issuing HTTP requests. A later grant resumes exactly one fresh
inspection. Until that inspection returns an operational snapshot, Flower does
not request settings, threads, attachments, handler resolution, or the live
stream. When a Runtime restart invalidates local access, the password gate
replaces the recovery presentation; a successful regrant begins one fresh
readiness and Flower initialization sequence.

Loading, backup, and restore share one compact Flower mark, one phase title, and
a thin indeterminate progress track. The default view has no decorative documents,
repeated brand label, or explanatory paragraphs; it never invents a percentage,
remaining time, or polling countdown. The announcement-focused heading has no
visual focus frame; interactive controls retain visible keyboard focus.
The initial 150 ms delay applies once per busy period; phase changes update the
same visible surface, retaining open details, keyboard focus, and animation nodes.
While busy, the mark uses the [shared whole-bloom progress rotation](../ui/flower-output-progress.md#progress-symbol)
without changing either theme's artwork.
Startup details can be expanded throughout preparation to read the phase
explanation, data-preservation statement, workspace availability, and diagnostics.
After ten seconds the UI shows real elapsed time without live-region announcements;
after thirty seconds it adds one short reminder that files and terminals remain
available. Longer startup guidance stays inside details. Preparation exposes Stop only when the canonical readiness snapshot marks it stoppable.
Stopping disables duplicate actions until rollback and close settle. Stopped offers explicit
Prepare again; cancellation never automatically restarts. Close failure requires application restart. Companion layout adapts to its own container, and reduced
motion disables decorative movement without hiding progress or status. Text stays
fully opaque during entry so contrast does not depend on animation completion.
The process-level
`agent.lock` remains the state-root owner, so another runtime attaches or reports
conflict instead of opening an empty Store. A terminal retry is user-controlled,
single-flight, and allowed only by typed safety plus current authority. Administrator-confirmed complete-set restoration follows the [Flower backup and recovery contract](../ai/flower-backup-and-recovery.md); it never offers force, reset, or ignore controls. Returning to `ready`
mounts a fresh Flower DOM after the previous surface has completed cleanup and
emits one non-blocking ready notice after a long startup.

Displayed diagnostics and clipboard output use the same sanitized projection.
Only the component, phase, real elapsed time, status, and bounded trace ID may appear;
raw paths, schema or SQL details, credentials, provider state, retry internals,
and tool output never cross the boundary. Unknown or contradictory facts become one
non-retryable contract failure. Settings reports the unified Flower storage lifecycle and keeps other settings usable. Administrators can review backup metadata and recovery impact before confirming a restore.


Desktop decodes the same phase, stop, retry-safety and workload facts through Runtime Service
snapshots. Its existing Welcome runtime-health owner remains the only refresh loop.
Authenticated readiness requests use the existing Flower bridge without preparing models
or acquiring an AI service. Back and environment navigation stay available. The boundary
shows completed/total counts only for a known total and preserves shell-owned drafts.

# Boundaries

Readiness UI is a process-local availability projection, never a second Agent lifecycle.
See the [owner and generation contract](ai-readiness-lifecycle.md) and
[complete-set recovery](../ai/flower-backup-and-recovery.md).

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/flower/AIReadinessBoundary.browser.test.tsx:1` - Browser interaction, reflow and recovery coverage.
- `redeven:desktop/src/welcome/flower/DesktopFlowerRuntimeBoundary.client.test.tsx:1` - Stop deduplication, explicit retry, failure and draft continuity.
- `redeven:desktop/src/main/runtimeFlowerRoutes.test.ts:1` - Exact authenticated readiness route and method boundaries.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.settingsLifecycle.test.shared.tsx` - Revision ordering, timeout, visible retry, draft continuity and independent Stop.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvAIPage.send.test.shared.tsx` - Delayed initialization survives repeated environment refresh and submits one Turn.
