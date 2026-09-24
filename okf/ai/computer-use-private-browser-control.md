---
type: Architecture Contract
title: Private browser observation and input
description: Fence secret-surface observation, private frames, ordered input and explicit handback to a canonical interaction.
tags: [ai, computer-use, browser, privacy]
timestamp: 2026-09-24T00:00:00Z
---
# Summary

Runtime owns observer-bound private input and pixels; Floret owns the unresolved
interaction and continuation through the [takeover contract](computer-use-takeover.md).
The user can finish a secret or verification step without exposing its content
to model history. Every operation binds the current observer, viewer revision,
thread, run and target. Unknown input outcomes never replay. Disconnect disables
input immediately; explicit recovery and a newly decoded matching frame are
required before control resumes.

# Contract

## Browser observation and private input

The shared browser controller examines visible password fields, `one-time-code` input
semantics, CAPTCHA text and explicit instruction-override signals in each frame.
CDP DOM snapshots include rendered password and OTP inputs inside closed shadow
roots. Isolated-world mutation observers cover the document and open shadow roots.
An unreadable frame is a technical observation failure, not a human requirement.
The shared controller retries only a read, at most once. Frame attachment,
detachment and navigation invalidate observations. Stable read failure returns
`TARGET_OBSERVATION_UNAVAILABLE` with confirmed `action_executed` and a closed
`observation_stage`; no page data or pixels survive. Runtime does not latch a
pause or create InputRequired for this error. The next authorized observation
may proceed. Viewer failure uses the existing unavailable/reconnect display.
It inspects before input, after an action, and
after capture. Secret DOM transitions are latched during observation so removing
a field before the final check cannot expose the already captured image.
Document changes during capture discard pixels and require a fresh observation;
an otherwise safe navigation does not require user takeover. Confirmed secret
evidence wins over concurrent frame invalidation. An unsafe result discards
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

Every admitted computer tool converts a typed safety pause through one result
boundary, including pre-dispatch selection checks. Confirmed script steps and
action outcomes survive this conversion. Sampling itself creates no interaction;
it stops public frames with a closed assistance classification. The next admitted
tool supplies Floret's canonical `InputRequired`. Diagnostics record only target
identity, source, reason and requested assistance, never page text or private input.

An explicit system-browser request with no live connection uses a separate
`browser_connection` question with canonical tool provenance. Its guide establishes
an extension connection without selecting a tab or enabling private control.
`Respond` rechecks current connected inventory; the resumed Agent discovers and
selects its own task page. Connection and verification share Floret lifecycle
ownership but grant different capabilities.

# Boundaries

Browser observation is a bounded protection, not proof of atomic safety across
all dynamic content. Public observation failure creates no private authority.
Private pixels, commands and raw helper errors cannot enter model history,
Activity or logs. Full product and native IME acceptance remain governed by
[Computer use qualification](computer-use-qualification.md).

# Evidence

- `redeven:internal/ai/computer_user_control.go` - authenticated non-model input.
- `redeven:scripts/check_computer_host_safety.mjs` - isolated real-browser safety and private form fixtures with cleanup.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopPrivateComputer.mjs` - isolated built Desktop, scripted provider, real private stream, delayed pixels, header FPS, paste, native IME and handback.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerStage.browser.test.tsx` - user-only Stage pixels and chat-input separation.
