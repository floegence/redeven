---
type: UI Contract
title: Markdown diagram rendering
tags: [flower, markdown, diagrams, preview]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Mermaid fences retain their authored syntax and source. Both Flower hosts and file Markdown previews consume the published Floe diagrams API, which uses the original published Pele package. Pele is external; Floe owns shared rendering, sanitization, scheduling and controls. Redeven owns document/region identity, semantic palette, localization and host context.

# Contract

Only complete Mermaid fences become diagrams in streaming Flower Markdown. Incomplete fences remain readable and copyable code. Closing a fence creates one diagram owner; subsequent prose, terminal completion and identical snapshot regions preserve its SVG, focus and selection. Changed/removed regions dispose their owners and cancel stale results. Nested mounts inherit host Dialog placement. File previews retain their reserved viewport and release diagrams before document replacement.

Theme changes use CSS variables without reparsing or replacing SVG. Product palette maps eight published series variables to semantic graph roles. Original source stays available with explicit copy feedback, local errors and retry. Expand uses the shared accessible Dialog with zoom/fit and Escape; inline diagrams do not capture wheel input. All shipped locales explicitly supply every control label.

Lazy imports and visibility scheduling keep diagram engines out of initial assets and avoid rendering offscreen history. No Mermaid.js runtime, alternate-engine fallback, private renderer, sibling import, package link, patched Pele or copied upstream implementation. Shared fixes land in Floe and reach both hosts through a new published release.

Floe disables image loading and diagram links unless navigation is explicitly host-owned; these adapters enable neither. Final SVG and formula MathML cross the published sanitizer. Source is never rewritten to repair unsupported syntax. Failures retain the original source. Source/edge/output/queue limits bound admission, not guarantees of constant rendering time. Cancellation fences results; it cannot preempt synchronous Pele work. Measure actual browser tasks and use the explicit Flower long-thread qualification for responsiveness.

# Evidence

- [File adapter](../../internal/envapp/ui_src/src/ui/file-markdown/mermaidPlugin.tsx) and adjacent tests verify source, stale roots, inherited ownership and disposal.
- [Flower adapter](../../internal/flower_ui/src/chat/markdown/FlowerMarkdownBlock.tsx) retains incremental region ownership; FlowerMarkdownDiagrams tests cover fence closure and escaping.
- [Production acceptance](../../scripts/check_flower_diagrams.mjs) builds with each host configuration and published dependencies, exercises Chromium and Electron file loading, streaming/completion/snapshot retention, source/copy, theme, expand/zoom/Escape, errors, lazy history and narrow layouts; supervised resources must close.
- [Explicit responsiveness qualification](../operations/flower-long-thread-gate.md) remains outside commit, integration and CI gates. Bounded fixtures do not prove fidelity or timing for arbitrary third-party syntax.
