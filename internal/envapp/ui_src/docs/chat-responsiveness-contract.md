# Redeven Chat Responsiveness Contract

This document defines the local responsiveness contract for Redeven's forked chat surfaces.

Visual ownership stays local to Redeven. We do not give up local transcript layout, local styling,
or local component structure in order to reuse upstream chat presentation. What must stay aligned is
the interaction and performance contract, not the exact UI tree.

## Goals

- Keep typing, scrolling, follow-bottom, and transcript navigation responsive.
- Preserve the current Flower and Codex user experience.
- Move expensive work out of render, input, and scroll hot paths.
- Add local guards so future styling work does not silently reintroduce blocking behavior.

## Non-negotiable UX rules

- `VirtualMessageList` remains the transcript owner.
- Live assistant output keeps the dedicated non-virtualized tail ownership model.
- User-triggered follow-bottom stays smooth; system restore stays instant.
- Code, diff, and diagram blocks keep their current visual treatments unless explicitly redesigned.
- Activity switching must update shell ownership synchronously before any heavy page bootstrap starts.
- Codex-specific network/bootstrap work must wait until the activated view has painted once.
- Codex transcript DOM must stay bounded to the viewport window instead of scaling with total history length.

## Rendering rules

### Transcript

- `ChatContainer` must continue using `VirtualMessageList` by default.
- Stream event reconciliation must stay batched outside the synchronous event stack.
- Host callbacks that can run arbitrary logic must leave the hot path first.
- Transcript bottom clearance must stay transcript-owned even when a page-specific floating composer is used.
- Page-level floating composer layouts must measure the real dock height and synchronize transcript bottom inset from that measured value instead of relying on a fixed magic-number spacer.
- View-local transcript surfaces such as Codex must use shell-first activation and defer remote bootstrap until after paint.
- View-local transcript surfaces must window row rendering so only visible rows plus overscan mount heavy subtrees.

### Markdown

- Streaming markdown must never block input or scroll.
- Large markdown rendering must continue to prefer the shared markdown worker path.

### Code Diff

- `CodeDiffBlock` must let the shell and header paint first.
- Small diffs may use deferred main-thread computation.
- Large diffs must prefer a worker-backed diff model.
- Large diff rendering must be bounded so huge patches do not create an unbounded DOM.

### Code Highlight

- `CodeBlock` must not synchronously initialize heavy highlighting work in the current paint.
- Large code blocks should prefer worker-backed highlighting when available.
- Fallback remains the existing plain `<pre>` presentation so the current UX degrades gracefully.

### Mermaid

- `MermaidBlock` keeps the current automatic rendering UX.
- Mermaid rendering must be scheduled after paint, and large diagrams should prefer idle-time work.
- Cached diagrams should be reused to avoid repeat renders for the same content.

## Engineering guardrails

- Heavy transcript blocks must keep their own non-blocking strategy local to this repository.
- New heavy blocks must document whether they use worker, after-paint, idle-time, or bounded-DOM rendering.
- Future styling-only work must not reintroduce synchronous heavy work on render, click, keydown, or scroll.
