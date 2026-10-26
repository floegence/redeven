---
type: Execution Contract
title: Computer script execution and semantic observations
description: Execute bounded JavaScript against one authorized target without exposing host capabilities or replaying partial effects.
tags: [ai, computer-use, scripts, accessibility]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

One `computer.exec` is one Floret tool invocation and one effect attempt.
`ComputerUseRuntime` owns its isolated QuickJS process and checks every host
operation. The guest receives only the controlled `ui`, `browser` and `log`
interfaces. Partial progress survives failure; uncertain effects never replay.
A page change ends the batch with successful partial progress for the Agent.
A permission requirement or private input ends it through Floret's existing
interaction boundary.

# Contract

## Guest API and limits
`computer.exec` requires a target, code and a user-readable description.

Approval Required uses the current target and URL in the existing tool approval; temporary authorization expires with the target lease and never becomes a persistent origin grant.

The Runtime admits at most eight active script namespaces. Tool-local documentation owns exact signatures: string names (no RegExp selectors), numeric scroll deltas, condition waits, and sequential awaited operations. Unsupported guest arguments fail before dispatch. Closed diagnostic codes distinguish reference/type/syntax/argument errors, operation concurrency and bounded output; raw interpreter exceptions remain private. A failed invocation retires its namespace while confirmed earlier actions survive.

Semantic snapshots retain their 256 KiB output budget. The script response allows a bounded 512 KiB envelope so metadata cannot make a valid snapshot fail at the transport boundary. Logs have a separate 64 KiB total budget. Local `emit:false` reads receive the same URL/title identity as emitted observations.

## Observation and references
The [semantic snapshot contract](computer-use-semantics.md) owns schema v2, role normalization, tree validation, states, relationships and privacy projection. `ui.getByRole(role, {name?, exact?, root_ref?})` uses a canonical role.

Private takeover keeps observations and pixels out of model history.

# Boundaries

## Partial effects and continuation
The Runtime revalidates target policy, grants, cancellation and current control before each host operation. The target remains owned by the same canonical turn across the batch; independent live sampling may run between operations.

No second history or recovery ledger exists.

# Evidence

- `redeven:internal/ai/computer_script.go` - namespace ownership, limits and partial results.

- `redeven:internal/ai/computer_observation.go` - bounded output diffs and document/scope resets.

- `redeven:internal/envapp/ui_src/scripts/redevenComputerScript.mjs` - restricted QuickJS API and process protocol.
