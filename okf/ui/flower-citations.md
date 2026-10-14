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
- Failure boundary: unmatched sources appear at the end of the completed message. Historical markers without stored sources show localized unavailable text; Flower never reconstructs missing facts.

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
sources appear in a compact source list after streaming finishes; repeated
unbound title/URL pairs appear once. Split streamed markers stay hidden until
complete metadata arrives. Invalid URLs never become links, and metadata changes
invalidate Markdown HTML without remounting stable code controls.

# Boundaries

Marked continues to own GFM/CommonMark syntax. Fenced code, code spans, HTML,
links, images and escaped literal marker examples remain unchanged. The message
copy action removes prose markers while code-block copy preserves literal code.
Flower does not repair malformed emphasis or alter ordinary Markdown/media
semantics. Citation copy is localized in every supported Env App and Desktop
catalog. New messages preserve complete sources; old records lacking sources
remain readable without rewriting historical data.

# Evidence

- [Provider mapping and stream consistency](../../internal/ai/model_gateway_citations_test.go)
- [Canonical historical blocks](../../internal/ai/floret_timeline_messages.go)
- [Marker adaptation and URL boundary](../../internal/flower_ui/src/chat/markdown/flowerCitations.ts)
- [Shared Markdown rendering](../../internal/flower_ui/src/chat/markdown/FlowerMarkdownBlock.tsx)
- [Current-view projection regression](../../internal/flower_ui/src/runtimeCurrentView.test.ts)
- [History mapper regression](../../internal/flower_ui/src/flowerLiveMapper.test.ts)
- [Citation and Markdown fixtures](../../internal/flower_ui/src/chat/markdown/flowerCitations.test.ts)
- [Chromium streaming and layout evidence](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.citations.browser.test.tsx)
- [Flower UI checks](../../scripts/check_flower_ui.sh)
