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

## Explain the required step

The UI derives the blocking reason from canonical tool Activity, not from a
second waiting-state store. Task access, tab selection, sign-in, one-time codes,
CAPTCHA, private input and unreadable pages have distinct instructions. Each
card identifies the target, explains the required action and names the next
step. Unknown inspection failures must not invent a login requirement. URL
keywords and ordinary text such as a search for password managers do not prove
that a secret field needs input; adapters inspect actual controls.

Outside full access, for site, application or foreground permission, show the exact requested scope
and **Allow and continue**. This explicit user command reads existing task
grants, adds only the displayed access and then requests canonical continuation.
It does not open a private viewer. Saving failure leaves the interaction pending;
changing conversations during the request must not grant access or continue a
different conversation. Already dispatched saves remain scoped to the original
thread. Runtime still performs fresh observation before `Respond`.

If that recheck finds a different blocker, the conflict response carries only
closed assistance kinds and validated origin/application display facts. The
pending card shows this latest observation for the same thread and interaction:
for example, an access grant can reveal a CAPTCHA, or another origin can require
a separate explicit grant. This transient feedback grants nothing and does not
replace the canonical pending interaction. No page contents or private values
are returned in the error.

Full access already authorizes sites, applications and foreground use on the
selected target, so new operations never pause for these grants. An existing
canonical permission pause shows **Full access is enabled** and **Continue task**;
continuation rechecks the page without saving another grant or replaying the
original action. Opening a conversation never resumes a paused task on its own.
The target selector explains full access and hides redundant grant editing;
switching back to a mode with approval reveals the existing saved grants.

Only a real manual step offers **Open page** and **Done, continue**. The browser
and desktop selector lives under **Browser and desktop**; it is not the primary
action for granting a site's access. An unresolved canonical computer interaction
displays waiting in its tool row even though the observation tool itself completed
successfully. Tool completion must not imply that the requested navigation ran.

## Canonical pause and return

Published Floret v7.12.0 `tools.Result.InputRequired` pauses the provider after the
completed tool batch. Redeven maps a takeover decision into a non-secret select
question. It preserves whether navigation already happened; a post-navigation
pause must not claim the action was unexecuted. Floret persists the result and
interaction through its public runtime and schema v12 migration. Redeven does
not keep a pending-interaction table or replay the original action.

A semantic script ends at this boundary too. It returns confirmed progress and
removes logs, semantic content and images on a sensitive pause. A new invocation
after handback observes again; the host never resumes a saved JavaScript program
counter. New site, target, application or foreground requirements use the same
existing interaction, with task grants owned by product settings.

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

The shared browser controller examines visible password fields, `one-time-code` input
semantics, CAPTCHA text and explicit instruction-override signals in each frame.
CDP DOM snapshots include rendered password and OTP inputs inside closed shadow
roots. Isolated-world mutation observers cover the document and open shadow roots.
An unreadable frame is unknown. It inspects before input, after an action, and
after capture. Secret DOM transitions are latched during observation so removing
a field before the final check cannot expose the already captured image.
Document changes during capture discard pixels and require a fresh observation;
an otherwise safe navigation does not require user takeover. An unsafe result discards
all captured bytes. These deterministic
signals are bounded protections, not a claim of complete injection detection or
atomic observation of all dynamic web content.

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

Native window AX, private Linux AT-SPI and extension Chrome now feed this same
Runtime boundary; see [desktop execution](computer-use-desktop.md) and
[browser connections](computer-use-browser.md). Their full product scenarios
remain separate acceptance obligations. Browser fixtures and permission metadata
alone do not prove arbitrary app safety or atomic observation of dynamic content.

# Evidence

- `redeven:internal/ai/computer_takeover.go` - canonical result and handback mapping.
- `redeven:internal/ai/computer_assistance_test.go` - explicit reasons and public Activity preservation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerAssistance.browser.test.tsx` - site approval, failed saves, conversation races and specific manual instructions.
- `redeven:internal/ai/computer_control.go` - serialized target resource leases.
- `redeven:internal/ai/computer_user_control.go` - authenticated non-model input.
- `redeven:internal/ai/computer_takeover_integration_test.go` - Service continuation, private input and restart checks.
- `redeven:internal/ai/computer_control_test.go` - isolation, handback and cancellation.
- `redeven:scripts/check_computer_host_safety.mjs` - isolated real-browser safety and private form fixtures with cleanup.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopPrivateComputer.mjs` - isolated built Desktop, scripted provider, real private stream, delayed pixels, header FPS, paste, native IME and handback.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - user-only Stage pixels and chat-input separation.
