---
type: UI Contract
title: Flower citations
description: Canonical assistant source ownership, safe links, and provider marker presentation.
tags: [ai, flower, markdown, citations]
timestamp: 2026-10-14T00:00:00Z
---
# Summary

- Authority: published Floret v7.32.0 assistant messages own durable sources; Flower reads current views and historical pages through the existing thread projection.
- Outcome: provider citation markers in prose become readable links with source titles. Copying a message removes those markers.
- Invariants: ranges use end-exclusive Unicode code-point indices in the exact assistant text. URLs must be HTTP(S), without credentials, whitespace or control characters. Marker identifiers never establish a URL.
- Failure boundary: unmatched sources appear at the end of the completed message. Historical provider markers without stored sources show localized unavailable text; Flower never reconstructs missing provider facts. Explicit Markdown bibliographies remain authored content.

# Contract

Provider annotations preserve title, URL and optional positions through the
model gateway and Floret provider adapter. OpenAI final text completes an exact
streamed prefix only. If final text differs from already emitted text, sources
retain their URLs but lose positional claims. Floret validates sources, binds
them to canonical assistant fragments and supplies the same facts in current
and detail projections. Redeven does not collect a second source inventory from
observation events or web tool results. Schema ownership stays with
[the Floret thread runtime](../ai/floret-thread-runtime.md).

Flower binds a citation only when its safe source range exactly covers a prose
marker. A grouped marker can carry several exact source annotations. Remaining
sources appear in a source-card list after streaming finishes; repeated
unbound title/URL pairs appear once. Split streamed markers stay hidden until
complete metadata arrives. Invalid URLs never become links, and metadata changes
invalidate Markdown HTML without remounting stable code controls.

# Boundaries

Marked continues to own GFM/CommonMark syntax. Code spans, HTML, links, images
and escaped literal marker examples remain unchanged. The message
copy action removes prose markers while code-block copy preserves literal code.
Flower does not repair malformed emphasis or alter ordinary Markdown/media
semantics. Citation copy is localized in every supported Env App and Desktop
catalog. New messages preserve complete sources; old records lacking sources
remain readable without rewriting historical data.

## Source-card presentation

Source cards show a numbered badge, complete title, source hostname, a compact
URL preview and an external-link affordance. The whole row is a keyboard-
focusable HTTP(S) link; the exact destination remains in its `href` and native
tooltip. Long titles wrap and URL previews truncate within the card. The list
uses two columns when space permits and one column on narrow surfaces, without
horizontal scrolling. Copy sources preserves the full bibliography text and
uses localized copy/completion labels. Inline provider citations retain their
source titles, with a quiet bordered treatment and visible keyboard focus.

## Authored bibliography

Assistant Markdown can already contain an explicit bibliography inside an
unlabelled, `text` or `plaintext` fence. A closed fence consisting entirely of
positive, uniquely numbered title/HTTP(S)-URL pairs receives the same cards,
preserving authored numbers and exact copied text. This is display-only authored
content: it neither fabricates canonical source annotations nor binds numeric
prose references to provider metadata. Other code languages, indented code,
mixed prose, unsafe URLs, duplicate numbers and incomplete fences retain the
ordinary code presentation. A streamed bibliography becomes cards only after
its closing fence arrives. User messages and fetched external Markdown do not
enable this assistant-specific presentation.

# Evidence

- [Provider mapping and stream consistency](../../internal/ai/model_gateway_citations_test.go)
- [Canonical historical blocks](../../internal/ai/floret_timeline_messages.go)
- [Marker adaptation and URL boundary](../../internal/flower_ui/src/chat/markdown/flowerCitations.ts)
- [Authored bibliography and source cards](../../internal/flower_ui/src/chat/markdown/flowerSourceCards.ts)
- [Bibliography rejection and copy fixtures](../../internal/flower_ui/src/chat/markdown/flowerSourceCards.test.ts)
- [Shared Markdown rendering](../../internal/flower_ui/src/chat/markdown/FlowerMarkdownBlock.tsx)
- [Current-view projection regression](../../internal/flower_ui/src/runtimeCurrentView.test.ts)
- [History mapper regression](../../internal/flower_ui/src/flowerLiveMapper.test.ts)
- [Citation and Markdown fixtures](../../internal/flower_ui/src/chat/markdown/flowerCitations.test.ts)
- [Chromium streaming and layout evidence](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.citations.browser.test.tsx)
- [Flower UI checks](../../scripts/check_flower_ui.sh)
