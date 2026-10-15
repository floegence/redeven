---
type: Interaction Contract
title: Computer use safety pauses and user control
description: Separate operation facts from independent Agent questions and require fresh observation before further input.
tags: [ai, computer-use, safety, takeover]
timestamp: 2026-10-15T00:00:00Z
---
# Summary

Floret owns questions, answers, cancellation and continuation. Redeven owns
computer execution, authorization, private input and media. Operations return
facts or errors; Flower decides whether to call `ask_user` separately. A blocked
capture is never a successful screenshot. Answers reach the Agent unchanged and
do not grant permission, clear safety or replay an operation. Fresh safe
observation is required before further actions. No host waiting table, recovery
journal or second conversation lifecycle exists.

# Contract

## Operation facts and independent questions

Confirmed login, CAPTCHA, one-time codes, private fields, missing permissions and
explicit user control return structured assistance facts. URL keywords and
ordinary page text do not prove a login requirement. Incomplete scans, unreadable
frames and failed capture return technical errors, including
`TARGET_OBSERVATION_UNAVAILABLE`, without creating questions or latching a human
requirement. Flower can make another read within its execution budget; persistent
failure requires an accurate explanation, never invented instructions to inspect.

Tools preserve `action_executed`, completed script actions and observation stage.
Post-action observation failure cannot invite replay of the action. Unknown side
effects remain terminal and non-retryable. Sensitive pauses discard page content,
script logs and pictures while retaining confirmed progress. The host never
resumes a saved JavaScript program counter.

When a real external step is necessary, Flower independently calls `ask_user`
with a useful question and the actual blocking tool call ID in `evidence_refs`.
Floret v7.43.0 exposes `ReasonCode`, `RequiredFromUser` and `EvidenceRefs` from the
canonical input record without changing storage or answer semantics. Tool rows
retain their execution outcome; only the separate question displays waiting.

## One canonical provenance resolver

`resolveComputerInputEvidence` is the only resolver for computer assistance.
It reads the public Floret view and requires exact tool call evidence in the same
Thread and Turn, a closed assistance classification and unambiguous typed target
facts. Later observations of that target invalidate an older cited blocker.
Titles, question wording, arbitrary addresses and evidence references alone are
never authorization. Current product grants are checked separately at execution.

Existing canonical tool-origin interactions use their canonical ToolCallID and
Run through this same resolver. They remain answerable and stoppable, including
after restart. Their specialized acknowledgement controls remain readers of
existing history; operations no longer generate these interactions. The upstream
public `tools.Result.InputRequired` contract remains supported by Floret.

Missing, ambiguous or stale evidence exposes ordinary answering and Stop, with
no private control capability. A missing target or disconnected browser does not
block answering. Flower can discover or select another authorized target after
continuation. Connection and installation guidance is auxiliary to independent
questions; finishing a guide never silently selects an answer. Existing
history-bound setup acknowledgements retain their scoped continuation behavior.

## Answer, observe, continue or stop

Independent questions retain their generated question IDs, choices and text
editor. Permissions change only through the authenticated product settings entry.
The answer does not certify installation, connectivity, sign-in or authorization.
A failed setup panel allows retry, close and ordinary answering or Stop; changing
conversations always remains possible. Closing a viewer only closes viewing.

Floret admits an answer and starts a new Run in the same Turn. Runtime advances
only existing resources belonging to that Thread and Turn, including paused
resources, so terminal cleanup can release them. It does not acquire a target or
clear protection. A fresh `computer.observe` or `computer.screenshot` must
establish safe state before writes; another blocker returns facts for Flower to
judge again. The original operation is never replayed automatically.

`ComputerUseRuntime` serializes input, observations and sampling through one
target gate. Private commands match the unresolved canonical interaction and
its execution identity; a question name cannot authorize input. Other threads
cannot capture or manipulate a leased target. Safe target switches release the
previous target. Stop, cancellation and terminal views release matching Run
resources without releasing a later Run's ownership. Lock acquisition respects
cancellation. Reconnect reads canonical current and never restores control from
presentation state.

[Private browser observation and input](computer-use-private-browser-control.md)
owns observer-bound private pixels, ordered input and explicit reconnect
recovery. These process-local controls do not become durable Floret state.

# Boundaries

Full access retains the existing site, application and foreground rules.
Explicit private content still blocks public capture. Historical temporary
viewer pixels never become saved screenshots. This change adds no full-desktop
capture or target selection policy.

# Evidence

- `redeven:internal/ai/computer_takeover.go` - factual failures and the canonical provenance resolver.
- `redeven:internal/ai/computer_input_evidence_test.go` - evidence, ambiguity, stale facts and public projection.
- `redeven:internal/ai/computer_takeover_integration_test.go` - independent questions, restart, private input and no repeated navigation.
- `redeven:internal/ai/computer_control.go` - target ownership and continuation.
- `redeven:internal/ai/computer_control_test.go` - isolation, fresh checks and terminal release.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.computerLifecycle.browser.test.tsx` - ordinary independent answers, Stop and viewer interruption.
