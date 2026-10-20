---
type: UI Contract
title: Flower code highlighting
description: Color stable Markdown code without disturbing streaming, selection, copy or layout.
tags: [flower, markdown, syntax, performance]
timestamp: 2026-10-20T00:00:00Z
---

# Summary

Flower owns Markdown parsing and committed segment lifetime. Published Floe
`enhanceCodeBlock` owns visible-code tokenization, scheduling and color application.
Completed language-labelled fences receive syntax colors in both Env App and
Desktop. Original code remains immediately readable and copyable. Highlighting
must not alter text, frame geometry, copy controls, focus or an active selection;
unavailable or excessive highlighting work leaves plain code visible.

# Contract

## Stable content boundary

Flower decorates only regions changed by the published incremental parser.
Ordinary text/code growth appends locally. Closed top-level fences may receive
colors immediately while later text is generating; unfinished or nested active
fences remain readable and receive enhancement once at settlement.

Each region retains its disposers and completion callbacks. Finalization only
finishes unfinished decoration: it never releases an already settled code block,
recreates its copy icons, resubmits Worker work or replaces a protected selection.
Replacement and unmount release pending enhancement. Inline code remains inline.

The renderer separately escapes the first fence-info word as language metadata.
Presentation class sanitization does not redefine language identity: fence
metadata, case, and aliases such as `py`, `sh`, `c++` and `c#` reach the released
grammar contract. HTML preview fences retain the existing media contract.

# Boundaries

## Interaction and cost

Floe parses in one lazy Worker and schedules only visible blocks. The shared API
adds color-only spans inside the existing code element. It preserves text and
line endings and never inserts grammar output as HTML. Copy reads textContent.
Light and dark colors follow the inherited color scheme; changing the theme
does not parse or replace code. A selection intersecting the code defers color
application until selection leaves. Disposal suppresses stale results.

The published API bounds source to 32,768 UTF-16 units, each line to 2,000 units,
color runs to 4,096, and waiting requests to 128. Unlabelled, unsupported or
excessive code stays plain. Worker load, message, or execution failure, including
the 15-second deadline, settles pending work without retry loops. These limits
affect decoration only; they never truncate output or disable copying.

# Acceptance

Use frozen, published dependencies in both hosts. The focused browser tests cover
real Python/Bash colors, alias metadata, nested and raw tails, stop finalization,
replacement/retry/clear/unmount, exact copying, theme/selection/geometry, deferred
history, and 300 alternating stream updates with zero changes to stable code.

The production fixture builds with each host's actual Vite and CSS configuration,
loads workers under the Env App base path and an isolated Electron file URL, and
records geometry, focus/selection, requests, DOM mutations, frame P95 and long
tasks. It exercises 120 frame-paced appends, 200 history blocks, a 300-line code
block and a narrow viewport. It requires zero stable-code mutations or repeat
requests during appends, frame P95 below 35 ms and no task of 100 ms or more.
Timing is evidence for the bounded fixture, not a guarantee for unlimited input.

```bash
bash scripts/check_desktop_electron_test_runtime.sh desktop
node scripts/check_flower_code_highlighting.mjs --output=/tmp/flower-code-highlighting
```

# Evidence

- [Region lifetime and released enhancement](../../internal/flower_ui/src/chat/markdown/FlowerMarkdownBlock.tsx)
- [Escaped fence metadata](../../internal/flower_ui/src/chat/markdown/markedConfig.ts)
- [Browser interaction acceptance](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.highlight.browser.test.tsx)
- [Production acceptance runner](../../scripts/check_flower_code_highlighting.mjs)
- `@floegence/floe-webapp-core` v0.86.50 - Published incremental parser and bounded highlighter consumed by both hosts.
- [Streaming stability](flower-streaming-stability.md)
