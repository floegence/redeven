---
type: Interaction Contract
title: Computer use safety pauses and user control
description: Keep sensitive browser input outside model history and resume canonical tool-requested input only after fresh target observation.
tags: [ai, computer-use, safety, takeover]
timestamp: 2026-09-15T00:00:00Z
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

The current resource lease identifies its thread, turn and run. Floret input
continuation creates a new run within that turn. Binding its canonical execution
identity advances existing non-user leases before provider work, including a
text-only continuation; it never acquires an unowned target or returns user
control. Private commands still match the original pending interaction run. Another thread cannot
capture or manipulate a leased target. A safe target switch releases the
previous target; canonical terminal views release only the matching run's lease.
An old terminal notification cannot release a later run's target.

A takeover retains user control even if the page becomes safe. Model actions and
ordinary live sampling remain blocked until explicit handback. Waiting for the
target lock respects cancellation before dispatch. These process-local leases
own external resources, not a second Floret lifecycle or recovery journal.
After restart, an authorized pending interaction reestablishes user control from
canonical provenance before accepting a private command.

## Browser observation and private input

The Playwright helper examines visible password fields, `one-time-code` input
semantics, CAPTCHA text and explicit instruction-override signals in each frame.
An unreadable frame is unknown. It inspects before input, after an action, and
after capture; an unsafe result discards the captured bytes. These deterministic
signals are bounded protections, not a claim of complete injection detection or
atomic observation of all dynamic web content.

The authenticated `POST /_redeven_proxy/api/ai/computer/input` accepts only a
current computer input interaction and a bounded observe/click/type/key/scroll
command. The adapter reuses the same helper exchange but returns pixels only to
the authenticated caller. Request bodies, field values, raw helper errors and
screenshots must not enter Activity, model history, logs or the durable media
store. The endpoint returns PNG bytes with `Cache-Control: no-store`; Desktop
transports them through its existing private IPC boundary.

Flower presents localized takeover/handback controls in the input card.
Takeover and handback use content-sized standard buttons that wrap on narrow
surfaces. Computer input has one handback action; the generic question Continue
button is not shown. The ordinary Stop control remains available while waiting
for the user and preserves the same cancellation contract as active execution.
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
of silently losing characters. Explicit observation is required before further
input after a failure. Closing the image hides it; neither a later Activity nor
an in-flight private response reopens it. Explicit takeover or the Activity
viewer action opens it again. Selecting another thread resets viewer visibility;
ending the turn uses the existing Stop behavior.

The Runtime's canonical target lease is the authority for admitting another
turn. Browser requests carry a host-derived thread/turn session hash, stable
across handback runs and independent of model arguments. When a newly admitted
turn follows abandoned private control, the managed helper replaces its private
page with a blank page before observation or navigation. It retains the browser
profile but does not expose or act on the abandoned page. Same-turn control
continues to require explicit handback. Connected browser tabs are user-owned
and are never closed or replaced by this managed-page recovery.

# Boundaries

Service tests cover pause, private input, rejected stale input, handback,
re-observation, a real resumed screenshot tool, no action replay and restart using production tool registration
and Floret runtime. Browser helper fixtures cover login, OTP, CAPTCHA, injection
and framed login independently, plus a real user form submission and explicit
return. Browser UI tests verify decoded user pixels and separation from chat
submission. These are separate from built Desktop/DeepSeek qualification.

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
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - user-only Stage pixels and chat-input separation.
