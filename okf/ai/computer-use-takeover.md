---
type: Interaction Contract
title: Computer use safety pauses and user control
description: Keep sensitive browser input outside model history and resume canonical tool-requested input only after fresh target observation.
tags: [ai, computer-use, safety, takeover]
timestamp: 2026-10-08T00:00:00Z
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
second waiting-state store. Ordinary popup selection returns to the Agent and
does not create a user assistance card. Task access, sign-in, one-time codes,
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

Published Floret v7.25.2 `tools.Result.InputRequired` pauses the provider after the
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

`ComputerUseRuntime` alone serializes target actions, observations and control.
Its bounded pause retains the original target and reason, including safety found
by live sampling. Canonical Floret thread, turn and run identify ownership;
uninitialized legacy fields cannot authorize actions. Helpers classify the current
page without replacing CAPTCHA with `user_control` or navigating to a blank page
on a new Turn.

Leases identify thread, turn and run. Floret continuation starts a new run in
the same turn, advancing existing non-user leases before provider work without
acquiring unowned targets or returning user control. Private commands match the
original interaction run. Other threads cannot capture or manipulate a leased
target. Safe target switches release the previous target; terminal views release
only their matching run, never a later run’s target.

A takeover blocks model actions and public sampling until explicit handback,
even if the page becomes safe. Cancellation releases ownership; later observations
still inspect the actual page for private content. Lock acquisition respects
cancellation before dispatch. After restart, pending canonical provenance must
authorize private commands again. These process-local resource controls do not
form a second Floret lifecycle or recovery journal.

## Private browser control

[Private browser observation and input](computer-use-private-browser-control.md) owns secret-surface observation, observer-bound pixels, ordered input, handback admission and reconnect recovery. These operations use the canonical interaction and target ownership defined here.

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
- `redeven:internal/ai/computer_takeover_integration_test.go` - Service continuation, private input and restart checks.
- `redeven:internal/ai/computer_control_test.go` - isolation, handback and cancellation.
