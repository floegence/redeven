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

## Validated inputs and bounded browser reads
The browser adapter validates the complete operation before virtual focus,
scroll preparation or input. Invalid arguments retain a closed diagnostic with
phase, field, expected form and recovery; page errors and supplied secrets are
never copied into it. Keys use characters or documented names with
Alt/Control/Meta/Shift modifiers; physical codes such as Equal are not names.
Primitive computer.wait defaults to zero milliseconds and adds no settling
promise. Conditional waits retain their state and timeout contract.

Browser locators expose query({limit,cursor}) over the authorized loaded AX
scope and an attribute allowlist. Results carry total, truncation, document and
cursor; changed contents invalidate pagination. Only returned page references
enter the bounded reference table. Each page is at most 200 items and 48 KiB of
items. Virtualized, unloaded rows are never counted as visited. href removes
credentials, query and fragment and must not be reconstructed as an action URL.
scroll_progress belongs to the scroll return value. It reports immediate
before/after measurements, with null or unchanged values remaining inconclusive.

Repeated identical observations in the same script namespace/document/scope
receive a bounded advisory after two repeats. This never replays input, changes
target, adds a planner, or persists a second lifecycle.

# Boundaries

## Partial effects and continuation
The Runtime revalidates target policy, grants, cancellation and current control before each host operation. The target remains owned by the same canonical turn across the batch; independent live sampling may run between operations.

No second history or recovery ledger exists.

# Evidence

- `redeven:internal/ai/computer_script.go` - namespace ownership, limits and partial results.

- `redeven:internal/ai/computer_observation.go` - bounded output diffs and document/scope resets.

- `redeven:internal/envapp/ui_src/scripts/redevenComputerScript.mjs` - restricted QuickJS API and process protocol.
