---
type: Interaction Contract
title: Computer use safety pauses and user control
description: Separate operation facts from independent Agent questions and require fresh observation before further input.
tags: [ai, computer-use, safety, takeover]
timestamp: 2026-10-15T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
Confirmed login, CAPTCHA, one-time codes, private fields, missing permissions and explicit user control return structured assistance facts. Flower can make another read within its execution budget; persistent failure requires an accurate explanation, never invented instructions to inspect.

Tool rows retain their execution outcome; only the separate question displays waiting.

## One canonical provenance resolver
`resolveComputerInputEvidence` is the only resolver for computer assistance. Titles, question wording, arbitrary addresses and evidence references alone are never authorization.

Existing history-bound setup acknowledgements retain their scoped continuation behavior.

## Answer, observe, continue or stop
Independent questions retain their generated question IDs, choices and text editor. A failed setup panel allows retry, close and ordinary answering or Stop; changing conversations always remains possible.

These process-local controls do not become durable Floret state.

# Boundaries

Full access retains the existing site, application and foreground rules. Historical temporary viewer pixels never become saved screenshots. This change adds no full-desktop capture or target selection policy.

# Evidence

- `redeven:internal/ai/computer_takeover.go` - factual failures and the canonical provenance resolver.

- `redeven:internal/ai/computer_input_evidence_test.go` - evidence, ambiguity, stale facts and public projection.
