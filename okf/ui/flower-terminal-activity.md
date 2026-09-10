---
type: UI Contract
title: Flower terminal activity presentation
description: Terminal output, truthful result messages, safe input confirmation, and read-only controls.
tags: [ai, flower, terminal, presentation]
timestamp: 2026-09-10T00:00:00Z
---
# Summary

Flower renders canonical Floret v7 Activity facts. Host-authored labels and descriptions explain the task; every terminal operation has safe expandable details, including writes and empty reads. Disclosure and output scrolling are local presentation state. They never create process lifecycle facts or expose stdin, private working paths, or effect internals. Actionable approval controls belong to the composer.

# Contract

## Terminal facts

Floret owns the nested `ActivityItem.presentation` contract and merges results with their stable call presentation. Redeven maps the same typed presentation from bootstrap and live current replacement. Labels and descriptions are authoritative; the typed operation supplies localized fallback text. Existing v7 history without an operation retains the known terminal fallback. Redeven consumes the additions from published Floret v7.3.1. The public activity sanitizer preserves the existing `terminated` outcome so stopped-command details survive live delivery and history loading.

Published Floret v7.9.2 publishes validated call presentation before tool output.
The collapsed row immediately shows its description; expanding immediately
reveals the sanitized command. All tool details remain collapsed until manually opened, including waiting and
running calls with attention facts. Running titles retain the existing sweep.
Only the output region may wait for output.
Result events settle the row while the model continues generating, and current
replacements preserve manual disclosure, command selection, and scroll ownership.

Every `exec`, `read`, `write`, and `terminate` row exposes a chevron and detail panel from its first appearance. The semantic title explains intent once. Expanded details prioritize the returned output, directly below a compact command header when a safe command is available. They do not repeat the description or render a status/metadata table. Missing command snapshots do not expose opaque process ids or invent a target.

Write details confirm input sent, failure to send, or waiting to send. They exclude raw input and output that could echo it. Read details show that invocation's incremental output, or a localized no-new-output message. Execution with a successful launch but no exit code and no output says the command started without output yet; it does not claim the process completed. A recorded zero exit code with no output says the command finished without output. Nonzero exit codes, timeouts, and confirmed termination have concise result messages alongside any captured output. Partial output is identified in plain language. Output sequence numbers, byte counts, execution locations, duration, and private working paths are not presentation content.

The canonical activity status describes the invocation, not the continued lifetime of its target process. A completed read or write must never imply that the command has exited. Result messages consume existing canonical exit, timeout, and termination facts; they do not reconstruct process lifecycle or derive completion from a successful tool call. Invocation errors retain their complete public error detail. Rejected and canceled operations cannot display a success confirmation. Empty states and output-refresh failures are localized and do not obscure returned output.

Historical output without sequence metadata is an unsequenced static snapshot; live deltas remain sequence-strict. For running exec details, a newer cumulative snapshot replaces the view and a contiguous process-read delta appends. Equal or older snapshots are ignored; empty deltas preserve output; a declared truncated gap replaces the unavailable prefix. Flower requests only `after_seq` for an executing command with a public process id. Read and write panels never start another process poll. Process reads can stop local polling but cannot change canonical status. Transport cursors remain internal to output ordering.

Details are read-only, offer localized icon actions to reveal and copy the command, and cap output at five visual lines with independent scrolling. Execution and settlement belong to [Terminal tool runtime](../ai/terminal-tool-runtime.md) and [Floret thread runtime integration](../ai/floret-thread-runtime.md).

## Interaction boundary

[Activity disclosure interaction](flower-activity-interaction.md) owns stable triggers, manual choices, animation, transcript following, and floating controls across all renderers. Terminal output additionally owns its separate 24 px near-bottom following threshold and five-line viewport. Approval state is never a row badge, chip, metadata line, title suffix, tooltip, detail, or ordinary activity ARIA label. The composer exclusively owns actionable approve/reject controls. Completing a decision removes that dock without inserting an approval outcome into history.

# Boundaries

Activity details are designed renderer views, never arbitrary payload inspectors. Errors, terminals, files, patches, web search, questions, completion, todos, and SubAgents each prioritize their user-facing information. Read, list, find, grep, glob, and web views expose semantic scalars or bounded scalar lists: path, root, query, pattern, URL, and count. Unknown tools use a neutral `Called <semantic label>` title and the same allowlist. A human label never authorizes nested `data`, `result`, or protocol JSON.

Failed tools retain the public summary in the row and complete public message in an manually expandable error detail. Error codes, retryability, tool/item ids, and lifecycle diagnostics remain hidden. Successful tools omit generic completion summaries and event codes such as `tool execution completed`, `todos.updated`, `file.updated`, `success`, `completed`, and `ok`. Rich metadata belongs only to explicit product renderers such as OKF and skill activation. Presentation never changes Floret status, ordering, persistence, read acknowledgement, audit state, or terminal settlement.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - The Env adapter maps authorized terminal output reads to the product API without owning process lifecycle.
- `redeven:internal/ai/terminal_activity_test.go` - Verifies typed terminal outcomes survive the public activity sanitizer.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Flower renders typed terminal activity detail and accessible execution status without approval presentation.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - Terminal detail projects output and result facts while omitting duplicate intent and diagnostic metadata.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts` - The wire adapter maps the closed Floret v7 nested activity presentation contract.
- `redeven:internal/flower_ui/src/flowerTerminalOutput.ts` - Static snapshots, sequenced live deltas, and the 24 px local-following threshold have one owner.
- `redeven:internal/codeapp/appserver/server.go` - Appserver exposes authorized terminal process read, write, and terminate routes.
- `redeven:internal/flower_ui/src/activityDisclosure.ts` - One Web Animation owner handles measured height, retargeting, reversal, and unmount.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.finalArchitecture.browser.test.tsx` - Streams canonical SubAgent tool replacements while proving activity-row and terminal-viewport identity plus independent scroll ownership.
- `redeven:internal/flower_ui/src/styles/flower.css` - Shared Flower styling owns the bounded terminal output viewport.
- `redeven:internal/envapp/ui_src/src/styles/redeven.css` - The shipped Env App stylesheet preserves the same bounded output presentation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.terminalActivity.browser.test.tsx` - Verifies output-first details, honest empty execution results, input privacy, keyboard disclosure, streamed replacement, task navigation, and narrow layouts.
