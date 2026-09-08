---
type: UI Contract
title: Flower terminal activity presentation
description: Canonical terminal activity, disclosure, animation, scrolling, and read-only controls.
tags: [ai, flower, terminal, presentation]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Flower renders canonical Floret v7 Activity facts. Host-authored labels and descriptions explain the task; every terminal operation has safe expandable details, including writes and empty reads. Disclosure and output scrolling are local presentation state. They never create process lifecycle facts or expose stdin, private working paths, or effect internals. Actionable approval controls belong to the composer.

# Contract

## Terminal facts

Floret owns the nested `ActivityItem.presentation` contract and merges results with their stable call presentation. Redeven maps the same typed presentation from bootstrap and live current replacement. Labels and descriptions are authoritative; the typed operation supplies localized fallback text. Existing v7 history without an operation retains the known terminal fallback. Redeven consumes the additions from published Floret v7.3.1.

Every `exec`, `read`, `write`, and `terminate` row exposes a chevron and detail panel. A missing command snapshot leaves a named terminal session and purpose, without an empty `$` prompt. Write details show purpose, safe target, actual sent-byte count, and status; they exclude raw input and output that could echo it. Read details show the invocation's incremental output, cursor range, total bytes, and remaining-output flag, with an explicit no-new-output state. Termination shows its target, result status, and final output. Public payloads exclude local `cwd`, `workdir`, and `stdin`.

Completed status, output, exit code, and duration come from canonical Activity. Historical output without sequence metadata is an unsequenced static snapshot; live deltas remain sequence-strict. For running exec details, a newer cumulative snapshot replaces the view and a contiguous process-read delta appends. Equal or older snapshots are ignored; empty deltas preserve output; a declared truncated gap replaces the unavailable prefix. Flower requests only `after_seq` for an executing command with a public process id. Read and write panels never start another process poll. Process reads can stop local polling but cannot change canonical status. AppServer errors map to localized output or terminal-action failures.

Details are read-only, offer icon actions to reveal and copy the command, and cap output at five visual lines. Execution and settlement belong to [Terminal tool runtime](../ai/terminal-tool-runtime.md) and [Floret thread runtime integration](../ai/floret-thread-runtime.md).

## Disclosure identity and interaction

Each stateful activity view uses thread, run, turn, and canonical `item_id` as its identity. Status, payload, block position, item position, and renderer object identity are excluded. A current-view replacement can move the item between message blocks while preserving the row, disclosure controller, detail component, and terminal viewport. If a stable item gains a renderer or payload later, its DOM identity and trigger binding remain stable; native disabled state follows detail availability.

Ordinary pending, running, and completed details start closed. Errors, waiting items, and facts requiring attention start expanded. Manual choices persist across lifecycle updates, canonical replacements, and task navigation; explicit collapse wins over later status updates. Triggers expose `aria-controls`, native keyboard activation, pointer affordance, and focus restoration before closing. Background progress never opens ordinary running details or changes transcript geometry simply because time passed.

Approval state is never a row badge, chip, metadata line, title suffix, tooltip, detail, or ordinary activity ARIA label. The composer exclusively owns actionable approve/reject controls. Completing a decision removes that dock without inserting an approval outcome into history.

## Motion and scroll ownership

The shared disclosure controller owns measured pixel height using Chromium `ResizeObserver` and Web Animations. Opening starts at `0px` and takes 360 ms; closing takes 300 ms. Content growth, shrinkage, and responsive reflow use 280 ms. One current animation owns opening, resizing, retargeting, reversal, and closing; its `finished` promise alone advances presence or unmounts content. CSS and elapsed timers never create a second completion clock. New content cancels the old animation and retargets the current measured height. The nearest disclosure owns dynamic resize; the Env App timeline wrapper animates only its own opening or closing.

Details cap at `min(42rem, 72vh)` and terminal output at five visual lines; additional content scrolls locally. Manual disclosure stops transcript tail-following before layout changes. Every timeline supplies its viewport scope explicitly: the main transcript and SubAgent windows cannot change one another's follow intent or anchor revision. Opening, resize, reversal, and closing preserve the clicked title's viewport position; new wheel or touch input cancels this temporary anchor immediately. Animation establishes measured height before committing its target; `ResizeObserver` retargets only for a changed bounded content height. Intrinsic-height estimates and `content-visibility` placeholders must not create another jump. Terminal output owns its separate 24 px near-bottom following threshold. Reduced motion commits measured height immediately with the same title anchor and close/unmount path.

# Boundaries

Activity details are designed renderer views, never arbitrary payload inspectors. Errors, terminals, files, patches, web search, questions, completion, todos, and SubAgents each prioritize their user-facing information. Read, list, find, grep, glob, and web views expose semantic scalars or bounded scalar lists: path, root, query, pattern, URL, and count. Unknown tools use a neutral `Called <semantic label>` title and the same allowlist. A human label never authorizes nested `data`, `result`, or protocol JSON.

Failed tools retain the public summary in the row and complete public message in an initially expanded error detail. Error codes, retryability, tool/item ids, and lifecycle diagnostics remain hidden. Successful tools omit generic completion summaries and event codes such as `tool execution completed`, `todos.updated`, `file.updated`, `success`, `completed`, and `ok`. Rich metadata belongs only to explicit product renderers such as OKF and skill activation. Presentation never changes Floret status, ordering, persistence, read acknowledgement, audit state, or terminal settlement.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - The Env adapter maps authorized terminal output reads to the product API without owning process lifecycle.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Flower renders typed terminal activity detail and accessible execution status without approval presentation.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - Terminal activity detail uses process, output, sequence, exit, and duration fields.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts` - The wire adapter maps the closed Floret v7 nested activity presentation contract.
- `redeven:internal/flower_ui/src/flowerTerminalOutput.ts` - Static snapshots, sequenced live deltas, and the 24 px local-following threshold have one owner.
- `redeven:internal/codeapp/appserver/server.go` - Appserver exposes authorized terminal process read, write, and terminate routes.
- `redeven:internal/flower_ui/src/activityDisclosure.ts` - One Web Animation owner handles measured height, retargeting, reversal, and unmount.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.finalArchitecture.browser.test.tsx` - Streams canonical SubAgent tool replacements while proving activity-row and terminal-viewport identity plus independent scroll ownership.
- `redeven:internal/flower_ui/src/styles/flower.css` - Shared Flower styling owns the bounded terminal output viewport.
- `redeven:internal/envapp/ui_src/src/styles/redeven.css` - The shipped Env App stylesheet preserves the same bounded output presentation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.terminalActivity.browser.test.tsx` - Verifies SSH input privacy, empty reads, keyboard disclosure, streamed replacement, task navigation, actionable details, and narrow layouts.
