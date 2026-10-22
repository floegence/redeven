---
type: UI Contract
title: Flower citations
description: Canonical assistant source ownership, safe links, and provider marker presentation.
tags: [ai, flower, markdown, citations]
timestamp: 2026-10-16T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: published Floret v7.32.0 assistant messages own durable sources; Flower reads current views and historical pages through the existing thread projection.
- Outcome: provider citation markers in prose become readable links with source titles. Copying a message removes those markers.
- Invariants: ranges use end-exclusive Unicode code-point indices in the exact assistant text. URLs must be HTTP(S), without credentials, whitespace or control characters. Marker identifiers never establish a URL.
- Failure boundary: unmatched sources appear at the end of the completed message. Historical provider markers without stored sources show localized unavailable text; Flower never reconstructs missing provider facts. Explicit Markdown bibliographies remain authored content.

# Contract

Provider annotations preserve title, URL and optional positions through the model gateway and Floret provider adapter. Floret validates sources, binds them to canonical assistant fragments and supplies the same facts in current and detail projections.

Invalid URLs never become links, and metadata changes invalidate Markdown HTML without remounting stable code controls.

# Boundaries

The published Floe Webapp v0.86.32 `createMarkdownParser` owns GFM syntax with CJK-aware emphasis boundaries for completed and streamed text. Display parsing never writes back to canonical messages or provider cache input. New messages preserve complete sources; old records lacking sources remain readable without rewriting historical data.

## Inline-code references
Inline Markdown code derives from the published Floe `--inline-code-foreground` and `--inline-code-background` pair.

Fenced code, copy behavior and canonical content remain independent.

Theme changes preserve focus, selection, DOM and geometry; see [message appearance](flower-message-appearance.md).

## Source-card presentation
Sources start collapsed, showing the count and a deduplicated stack of up to four website icons plus an overflow count. Sources never expose their own copy button. Inline citations retain their existing links.

## Website icons
The shared Flower UI bundles 27 common website marks from pinned theSVG assets with audited per-icon licenses. Icon enhancement runs independently after Markdown rendering; collapse/expand never restarts it.

The renderer receives image bytes, never a third-party tracking URL.

## Authored bibliography
Assistant Markdown can already contain an explicit bibliography inside an unlabelled, `text` or `plaintext` fence. This is display-only authored content: it neither fabricates canonical source annotations nor binds numeric prose references to provider metadata. User messages and fetched external Markdown do not enable this assistant-specific presentation.

# Evidence

- [Provider mapping and stream consistency](../../internal/ai/model_gateway_citations_test.go)

- [Canonical historical blocks](../../internal/ai/floret_timeline_messages.go)

- [Marker adaptation and URL boundary](../../internal/flower_ui/src/chat/markdown/flowerCitations.ts)
