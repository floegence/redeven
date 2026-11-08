---
type: UI Contract
title: Flower citations
tags: [ai, flower, markdown, citations]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Floret stores assistant sources with end-exclusive Unicode code-point ranges. Only safe credential-free HTTP(S) URLs link; marker IDs imply no URL. Provider/gateway annotations preserve title, URL and optional positions. Floret validates and binds them to canonical assistant fragments for current/historical projections.

# Contract

Invalid URLs never link; metadata invalidates Markdown HTML without remounting stable code controls. Unmatched sources follow completed messages; markers without stored sources show localized unavailable text.

# Boundaries

Published Floe Markdown parsing owns GFM syntax with CJK-aware emphasis boundaries for completed and streamed text. Display parsing never writes back to canonical messages or provider cache input. New messages preserve complete sources; old records lacking sources remain readable without rewriting historical data.

## Inline-code references
Inline Markdown code consumes the published Floe `--inline-code-foreground` and `--inline-code-background` pair directly, without desaturating assistant references. Prose and table references use `0.96em` and medium weight so compact identifiers remain readable beside CJK text. Linked references retain navigation affordances.

Porcelain Light uses deep burgundy ink on a pale rose inset. Normal and selected code text clear 7:1; the fill stays restrained while separating from the canvas by 1.14–1.2:1. The latter is a product design budget, not a control-boundary accessibility threshold. Acceptance includes dense mixed-language tables, both materials, desktop/narrow widths, native selection and theme-switch continuity.

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
