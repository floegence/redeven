---
type: UI Contract
title: Flower citations
description: Canonical assistant source ownership, safe links, and provider marker presentation.
tags: [ai, flower, markdown, citations]
timestamp: 2026-10-16T00:00:00Z
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

The published Floe Webapp v0.86.32 `createMarkdownParser` owns GFM syntax with
CJK-aware emphasis boundaries for completed and streamed text. Code spans, HTML,
links, images and escaped literal marker examples retain their existing behavior. The message
copy action removes prose markers while code-block copy preserves literal code.
CJK labels and quoted phrases may touch surrounding prose without added spaces.
Whitespace inside emphasis delimiters and unmatched delimiters remain literal.
Display parsing never writes back to canonical messages or provider cache input. Citation copy is localized in every supported Env App and Desktop
catalog. New messages preserve complete sources; old records lacking sources
remain readable without rewriting historical data.

## Inline-code references

Inline Markdown code uses the published Floe `--inline-code-foreground` and
`--inline-code-background` pair. Each of the 26 shell themes owns its palette;
Flower does not keep another color table. The span has a quiet fill, no border,
regular monospace text and cloned rounded decoration when a long path wraps.
Native selection reverses the readable token pair without changing the text.
User bubbles use the same opaque inset, preserving contrast independently of the
bubble accent. Linked code retains visible link styling; code links in user
bubbles use the inset foreground. Forced colors use system colors. Fenced code,
copy behavior and canonical content remain independent.

Browser acceptance covers all presets and both surface materials at desktop and
320px widths, exact published token consumption, text/selection contrast, native
selection, long paths, links, user bubbles and forced colors.

## Source-card presentation

Sources start collapsed, showing the count and a deduplicated stack of up to
four website icons plus an overflow count. The source toggle is independent of the answer action row above it. Sources never expose their own copy button. Expanded sources use quiet 36px single rows with unboxed numbers,
16px site icons, truncated titles, aligned hostnames and external-link arrows.
Below 420px of available content width, hostnames move under titles in 52px
rows. The whole row remains a keyboard-focusable HTTP(S) link with complete
title and destination in its tooltip. The answer copy action preserves the complete message and localized completion labels. Inline citations retain their existing links.

## Website icons

The shared Flower UI bundles 27 common website marks from pinned theSVG assets
with audited per-icon licenses. Domain matching respects label boundaries.
Monochrome marks use theme-aware alpha masks; color marks keep their colors.
Each source renders a generated hostname initial immediately. Icon enhancement
runs independently after Markdown rendering; collapse/expand never restarts it.
The adapter deduplicates pending origin requests and limits concurrency to four.
Delayed, missing or failed icons never disable copy, links, navigation or input.
Disposed regions ignore late completions.

For unbundled sites, both carriers use the authenticated read-only Runtime
endpoint at `/_redeven_proxy/api/flower/source-icon`. The Runtime fetches the
origin favicon or a declared icon from its homepage, verifies the content and
persists bytes and expiry under `cache/flower-source-icons` for 90 days. Restart
and remount reuse those bytes; failures receive a 24-hour negative cache.
This disposable presentation cache never changes canonical conversation data.
Desktop resource requests use an already running Runtime and skip model setup.

Remote icon work has a six-second total budget, four concurrent fetches,
bounded redirects and a 256 KiB body limit. Public-network validation applies
to every DNS result and redirect, and dialing uses the validated numeric IP.
Requests carry no user credentials or cookies. SVG content must be inert vector
geometry; raster dimensions are bounded and large raster images are reduced.
Generated icons remain visible if content validation, persistence or loading
fails. The renderer receives image bytes, never a third-party tracking URL.

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
- [Async icon enhancement and bounded resolver](../../internal/flower_ui/src/chat/markdown/flowerSourceIcons.ts)
- [Runtime icon cache and fetch policy](../../internal/codeapp/appserver/flower_source_icon.go)
- [Cache, restart and egress regressions](../../internal/codeapp/appserver/flower_source_icon_test.go)
- [Bundled icon provenance](../../assets/flower_source_icons.json)
- [Current-view projection regression](../../internal/flower_ui/src/runtimeCurrentView.test.ts)
- [History mapper regression](../../internal/flower_ui/src/flowerLiveMapper.test.ts)
- [Citation and Markdown fixtures](../../internal/flower_ui/src/chat/markdown/flowerCitations.test.ts)
- [CJK emphasis, literal code and stable streaming controls](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.emphasis.browser.test.tsx)
- [Chromium streaming and layout evidence](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.citations.browser.test.tsx)
- [Rendered answer action geometry and interaction coverage](../../internal/envapp/ui_src/src/ui/FlowerSurface.answerActions.browser.test.tsx)
- [Flower UI checks](../../scripts/check_flower_ui.sh)

## Final answer actions

Each final assistant answer ends with one quiet icon row above its sources:
Copy, Export HTML (download into a tray), and Fork (branch plus). The stable
completion time sits at the right; its tooltip contains the full local date.
Desktop buttons are 28px with 14px icons and 1.75px strokes; coarse pointers
retain 44px targets with the same compact icons. The row sits 8px below the
answer. Idle icons use a quieter theme-derived color and stay discoverable;
hover adds a subtle face, keyboard focus restores full contrast with a visible
outline, and copy/export confirmation uses the theme accent. Interaction never
changes row geometry. Labels remain available through tooltips and accessible
names. Text keeps native selection.
The row appears only for items named by a complete canonical final-answer
boundary with matching turn and run identity. Intermediate narration and
streaming text have no answer actions or completion timestamp, including when
process details are expanded. Missing or incomplete boundaries never imply a
final answer. Earlier confirmed answers retain their row during later turns.

HTML export uses the shared safe Markdown renderer, excludes reasoning and UI
controls, preserves source links and writes an independent UTF-8 document.
No favicon or network request is needed. The Fork adapter passes source_item_id
to the published Floret v7.46.1 SourceItemID contract. Floret owns canonical
anchor resolution and request-key replay; product code only authorizes and maps
DTOs. Retrying a transport failure reuses the key for that thread and answer.
