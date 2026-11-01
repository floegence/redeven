---
type: UI Contract
title: Flower code highlighting
tags: [flower, markdown, syntax, performance]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Flower owns committed Markdown lifetime; Floe enhanceCodeBlock owns visible tokenization/scheduling/color. Completed labelled fences receive colors in Env App/Desktop while source stays readable/copyable. Highlighting preserves geometry, focus and selection; unavailable or excessive work leaves plain code.

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

- [Browser interaction acceptance](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.highlight.browser.test.tsx)
