---
type: Execution Contract
title: Computer script execution and semantic observations
description: Execute bounded JavaScript against one authorized target without exposing host capabilities or replaying partial effects.
tags: [ai, computer-use, scripts, accessibility]
timestamp: 2026-09-26T00:00:00Z
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

`computer.exec` requires a target, code and a user-readable description. The
logical target may be omitted in favor of the thread's selected target.
Descriptions name user work, such as filling filters and checking results.
Source and technical diagnostics belong in expandable details.

Available operations are `ui.observe`, `ui.screenshot`, `ui.getByRole(role,
{name})`, `ui.ref(ref)`, coordinate click and drag, key input and `ui.assert`.
Locators expose `read`, `click`, `fill`, `press`, `scroll` and `waitFor`.
Browser targets additionally expose `browser.navigate`, `back`, `reload` and
`waitForDownload`. Desktop guests do not receive a browser namespace. `log`
returns bounded JSON facts, not a stream of intermediate screenshots.

`ui.observe()` returns `{observation: {document_id, nodes, truncated}}` with a
browser node count in `total`; a locator's
`read()` returns `{node}`. For example, check
`ui.assert((await field.read()).node.value === expected)`. `waitFor` accepts
`state` (`visible`, `hidden` or `enabled`) and `timeout_ms`; its returned `state`
must be checked for `timeout`. These are restricted APIs, not Playwright objects.

Every asynchronous operation must be awaited in sequence. At most one host
operation is outstanding. A caught host rejection seals the invocation; catching
it in JavaScript cannot authorize subsequent actions. Unawaited work cannot
outlive its tool call. The guest has no Node, file, network, raw CDP, cookie or
system-input object.

The host enforces 30 seconds and 50 host operations per invocation; QuickJS limits
the heap to 64 MiB and the stack to 512 KiB. Code and log output have independent
bounds. The Node process also has a bounded V8 heap. CPU interruption, memory
exhaustion, cancellation or invalid IPC retires that namespace. The script
cannot alter these limits or authorize another process.

A namespace is keyed by ThreadID + TurnID + TargetID. Explicit `globalThis`
variables survive successful calls in the same namespace; wrapper-local `const`
and `let` variables do not. Canonical turn completion, target change, revocation
and process restart destroy active state. Forks receive no guest variables or
control authority. The Runtime admits at most eight active script namespaces.

## Observation and references

Semantic nodes carry an opaque reference, role, original platform role, name,
non-sensitive value, states, supported actions and available bounds. Browser
frames retain their identity. A tree contains at most 200 nodes by default or
1,000 on an explicit query, and reports truncation. `root_ref` requests a local
subtree. A truncated name search or duplicate names fail as ambiguous rather
than selecting an arbitrary match.

Scripts always receive full observations for local inspection. Use
`ui.observe({emit:false})` to read and filter a tree without automatically
including it in the tool result. Only an explicitly emitted final observation
is projected to model output; a later mutation drops an earlier observation.
Across successful calls in the same script namespace, `format: "diff"` includes
changed/new `nodes`, `removed_refs` and an unchanged count. The baseline is the
last emitted tree, never a local-only read. `ui.observe({full:true})` requests
`format: "full"`, including after model context compaction. Direct
`computer.observe` remains a complete, independently readable observation.

One bounded tree per namespace is retained in memory. A different document,
subtree, limit, truncated result or a diff larger than the full tree produces a
full snapshot. Takeover, script failure and target/Turn cleanup retire the
baseline with the interpreter. No snapshot history or second Agent store is
introduced. The canonical tool result retains the emitted representation.

References belong to one target and current document/window instance. Navigation,
removed elements and handback invalidate them. Resolution rechecks the current
node before an operation. The next call observes again instead of guessing a
coordinate. Browser, AX and AT-SPI events wake condition waits. Timeout returns
the known condition state; it does not invent success. The old fixed-delay tool
remains available and is cancellable, but is not the normal script strategy.

Browser secret transitions observed during a capture remain latched until the
batch result is checked, even when the field has already disappeared. A changed
document during capture or a privacy read discards the image, tree and page
metadata and marks `observation_invalidated`. Confirmed action facts remain;
the next observation checks the new document without repeating the action or
inventing a private-input handoff. A persistent observation failure returns the
closed inspection error described in the [browser contract](computer-use-browser.md).
Site permissions, explicit Agent popup selection, takeover and uncertain
effects retain their existing boundaries. A script also drops cached observations
from before invalidation; its final result retains the flag until it obtains a
fresh observation.
These are deterministic privacy
checks, not a claim of atomic knowledge of every application or web component.
Private takeover keeps observations and pixels out of model history.

# Boundaries

## Partial effects and continuation

The Runtime revalidates target policy, grants, cancellation and current control
before each host operation. The target remains owned by the same canonical turn
across the batch; independent live sampling may run between operations.

Results record confirmed completed actions, operation count and final compact
observation. A popup returns `completed: false`, `target_changed`,
`opened_pages`, `opener_tab_id` and `action_executed` without `InputRequired`.
The Agent selects and observes the new page; it never reruns the opening action. Interpreter failure and timeout preserve this prefix and bounded
logs. A script that stops after a host rejection or guest exception is an
execution failure, never a successful tool or schema-regeneration request.
Closed diagnostic codes avoid leaking guest exception text. Output-limit
failures mark retained output as truncated. No partial script is replayed.
An acknowledged but failed or still-loading navigation preserves earlier
completed steps, but is not itself listed in `completed_actions`. Its result
retains `action_executed: true`, the navigation stage and safe network reason;
old observations, logs and images are discarded. It remains an execution error
with a usable target, so a new call in the same turn can observe and continue.
The [activity contract](../ui/flower-activity-interaction.md) owns intent and
input/result presentation. A sensitive
pause removes previous logs, semantic content and image attachments, retaining
only closed progress facts. `InputRequired` ends execution; after the user
responds, a new invocation must observe and continue from the actual state.
There is no suspended program counter and no automatic replay of the original
code. A lost effect acknowledgement terminates with `effect_outcome_unknown`.
Floret seals that uncertain invocation with its fixed terminal result and rejects
retry after restart. It does not persist a normal partial-success payload for
that invocation; the host must not invent one in a second history store.

# Evidence

- `redeven:internal/ai/computer_script.go` - namespace ownership, limits and partial results.
- `redeven:internal/ai/computer_observation.go` - bounded output diffs and document/scope resets.
- `redeven:internal/envapp/ui_src/scripts/redevenComputerScript.mjs` - restricted QuickJS API and process protocol.
- `redeven:internal/ai/computer_script_test.go` - lifetime, revocation, partial prefixes and uncertain effects.
- `redeven:internal/ai/computer_partial_result_integration_test.go` - canonical timeout results and unknown-effect retry rejection after restart.
- `redeven:internal/envapp/ui_src/scripts/computerScript.node-test.mjs` - heap/CPU/operation bounds and no escaping host calls.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserPage.mjs` - browser references and event-driven waits.
