---
type: UI Contract
title: Flower code highlighting
description: Color stable Markdown code without disturbing streaming, selection, copy or layout.
tags: [flower, markdown, syntax, performance]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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

Finalization only finishes unfinished decoration: it never releases an already settled code block, recreates its copy icons, resubmits Worker work or replaces a protected selection.

HTML preview fences retain the existing media contract.

Use frozen, published dependencies in both hosts.

Timing is evidence for the bounded fixture, not a guarantee for unlimited input.

```bash bash scripts/check_desktop_electron_test_runtime.sh desktop node scripts/check_flower_code_highlighting.mjs --output=/tmp/flower-code-highlighting ```

# Boundaries

## Interaction and cost
Floe parses in one lazy Worker and schedules only visible blocks. It preserves text and line endings and never inserts grammar output as HTML.

These limits affect decoration only; they never truncate output or disable copying.

# Evidence

- [Region lifetime and released enhancement](../../internal/flower_ui/src/chat/markdown/FlowerMarkdownBlock.tsx)

- [Escaped fence metadata](../../internal/flower_ui/src/chat/markdown/markedConfig.ts)

- [Browser interaction acceptance](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.highlight.browser.test.tsx)
