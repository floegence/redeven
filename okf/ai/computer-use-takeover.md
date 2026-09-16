---
type: Interaction Contract
title: Computer use safety pauses and user control
description: Keep sensitive browser input outside model history and resume canonical tool-requested input only after fresh target observation.
tags: [ai, computer-use, safety, takeover]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Floret owns durable waiting, response validation, cancellation and continuation.
Redeven owns target control and private user input. A safety observation completes
its original tool exactly once and requests canonical input; it must not become
an ordinary tool error that invites model retries. Sensitive images never enter
model attachments or durable keyframe storage. User handback requires a fresh,
safe observation of the original target. Missing provenance, permissions or
observation capability leaves the interaction unresolved.

# Contract

## Canonical pause and return

Published Floret v7.12.0 `tools.Result.InputRequired` pauses the provider after the
completed tool batch. Redeven maps a takeover decision into a non-secret select
question. It preserves whether navigation already happened; a post-navigation
pause must not claim the action was unexecuted. Floret persists the result and
interaction through its public runtime and schema v12 migration. Redeven does
not keep a pending-interaction table or replay the original action.

The canonical computer tool Activity binds `computer_control` to the actual
target. Handback authorizes the endpoint/thread and matches the unresolved
interaction's thread, turn, run and tool call against that Activity. A question
name alone never authorizes computer input. Ordinary Ask User behavior retains
its existing response path.

Before `Respond`, Runtime obtains a new screenshot and the adapter's current
safety observation. Changed target identity, missing safety data, a sensitive
page or invalid image prevents continuation. Successful handback resumes the
provider using Floret's canonical history. The host observation itself is not a
replay and is not persisted as another model tool result.

## Target control

Runtime serializes each target's actions, observations and control commands.
Target tool calls resolve thread, turn, and run identity exclusively from the
Floret canonical invocation, matching the terminal view that releases control.
Uninitialized legacy run fields cannot authorize an action. Failure diagnostics
record those same canonical identities.

Leases identify thread, turn and run. Floret continuation starts a new run in
the same turn, advancing existing non-user leases before provider work without
acquiring unowned targets or returning user control. Private commands match the
original interaction run. Other threads cannot capture or manipulate a leased
target. Safe target switches release the previous target; terminal views release
only their matching run, never a later run’s target.

A takeover retains user control even if the page becomes safe. Model actions and
ordinary live sampling remain blocked until explicit handback. Waiting for the
target lock respects cancellation before dispatch. These process-local leases
own external resources, not a second Floret lifecycle or recovery journal.
After restart, an authorized pending interaction reestablishes user control from
canonical provenance before accepting a private command.

## Browser observation and private input

The Playwright helper checks visible password fields, `one-time-code`, CAPTCHA
and instruction-override signals per frame before input, after actions and after
capture. Unreadable frames are unknown; unsafe captures are discarded. These
bounded checks do not claim complete injection detection or atomic observation.

The authenticated `POST /_redeven_proxy/api/ai/computer/input` accepts bounded
click/type/key/scroll commands and returns only an acknowledgement. It requires
the exact active workspace observer, viewer revision and unresolved interaction.
Canonical provenance supplies the original target, turn and run; full read,
write and execute permission is required. Authority is checked again after
acquiring the target gate. Input never automatically replays.

Continuous private viewing uses the shared sampler and workspace channel under
that same authority. Only the requesting observer receives its descriptors.
`GET /_redeven_proxy/api/ai/computer/private-frame` requires that observer,
revision, thread, unresolved interaction and frame ID; it returns PNG with
`Cache-Control: no-store`. Private pixels never receive `computer://` references,
model attachments or durable media entries. Input, pixels and raw helper errors
must not enter Activity, history, audit or debug logs. Desktop carries these
bytes through its existing private IPC boundary.

Handback stops new UI input, drains submitted commands and holds the target gate
across safe re-observation and canonical `Respond`. Queued input rechecks its
interaction after acquiring the gate, preventing late commands from reclaiming
returned control. Unsafe handback returns `computer_control_not_ready`; Flower
keeps the original interaction and explains inline that sign-in or verification
still needs completion. It resumes private viewing without replaying actions.

The localized input card has a compact status heading, muted explanation and
inline validation notice. Its wrapping footer groups Stop on the left and
content-sized takeover/handback buttons on the right. Handback replaces the
generic question Continue action. Stop retains ordinary canonical cancellation.
Explicit takeover opens the media-only Stage. Keyboard and pointer actions go to the
private endpoint; only the acknowledgement goes through `submitInput`. Images
are decoded before replacement and Blob URLs are retired on disposal. Failed
input does not replay automatically, and queued input is discarded after an
unknown failure or a changed thread/interaction. Unsent adjacent text input is
coalesced in order within a bounded batch; keys and pointer actions are barriers.
An offscreen editable carrier receives native text, paste and IME composition.
Only committed text reaches private input; composition drafts stay local and
the carrier is cleared immediately after submission or a control-owner change.
Non-text keys use the same ordered private queue. The image itself is not a
text editor and synthetic composition events do not qualify IME support.
A full command queue reports control failure and discards unsent input instead
of silently losing characters. Failed viewing requires explicit recovery before
further input. Hiding stops sampling, preserves target ownership and does not
allow late results to reopen the window. Reopening rechecks canonical authority.

A workspace connection boundary immediately disables private input, discards
unsent commands, invalidates the observer/viewer revision and rejects late frames.
The same interface retains its last decoded image with Connection lost. A new
`ready` never resumes private control. Resume control explicitly authorizes the
latest interaction and observer; only a matching newly decoded private frame
reenables input. An ended interaction collapses the viewer. Closing or switching
threads during recovery cancels decoding and prevents reopening. A new client
shows Waiting for you to take control; it does not infer Runtime restart. No
navigation, page restoration, or private input is replayed. Ordinary preview
reconnection never grants private input. Historical display and terminal collapse
follow the [media contract](computer-use-media.md).

The Runtime's canonical target lease is the authority for admitting another
turn. Browser requests carry a host-derived thread/turn session hash, stable
across handback runs and independent of model arguments. When a newly admitted
turn follows abandoned private control, the managed helper replaces its private
page with a blank page before observation or navigation. It retains the browser
profile but does not expose or act on the abandoned page. Same-turn control
continues to require explicit handback. Connected browser tabs are user-owned
and are never closed or replaced by this managed-page recovery.

# Boundaries

Service/browser fixtures cover pause, private and stale input, handback, safety,
no replay and restart. UI tests cover decoded pixels and separation from chat.
Built Desktop acceptance follows the [qualification contract](computer-use-qualification.md).

Native Accessibility safety, complete app/window takeover, extension-authorized
Chrome, remote input and full live-view qualification remain unaccepted until
their product scenarios pass. The existing metadata safety gate remains for
adapters that do not yet provide equivalent page/Accessibility protections; it
must be removed when that replacement is complete, not treated as evidence that
those targets are safe.

# Evidence

- `redeven:internal/ai/computer_takeover.go` - canonical result and handback mapping.
- `redeven:internal/ai/computer_control.go` - serialized target resource leases.
- `redeven:internal/ai/computer_user_control.go` - authenticated non-model input.
- `redeven:internal/ai/computer_takeover_integration_test.go` - Service continuation, private input and restart checks.
- `redeven:internal/ai/computer_control_test.go` - isolation, handback and cancellation.
- `redeven:scripts/check_computer_host_safety.mjs` - isolated real-browser safety and private form fixtures with cleanup.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopPrivateComputer.mjs` - isolated built Desktop, scripted provider, real private stream, delayed pixels, header FPS, paste, native IME and handback.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - user-only Stage pixels and chat-input separation.
