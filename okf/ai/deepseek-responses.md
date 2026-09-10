---
type: AI Provider Contract
title: DeepSeek Responses
description: Flower consumes Floret stateless Responses transport with explicit web tool limits.
tags: [ai, provider, deepseek]
timestamp: 2026-09-10T00:00:00Z
---

# Summary

Flower routes the DeepSeek provider to the published Floret v7.10.1 Responses gateway.
Floret owns `/responses` rendering, SSE parsing, reasoning, usage normalization,
function-call validation, and opaque provider history. Redeven only maps its
model DTOs and canonical dotted tool names to provider-safe aliases.

# Contract

Each request sends full input history. The route never sends `messages`,
`enable_search`, `previous_response_id`, `store`, or `include`. Reasoning off maps
to `reasoning.effort: none`; the selectable high and max levels keep their
existing model-catalog contract.

The official Responses tool compatibility table marks `web_search` and other
built-in tools as ignored. Responses format compatibility does not provide
hosted execution. The reviewed directory therefore marks Flash, Pro, and Vision
search as `unsupported`, without a search protocol. The shared resolver exposes
that fact to model APIs, UI, prompts, and normal Turn requests. New requests have
no native search declaration; this does not disable Responses, image input, or
local function tools such as `web_fetch` for a known public URL.

Unsupported hosted search configurations, including a frozen declaration from
an earlier Flower version, fail explicitly before dispatch. They are not silently
sent to an endpoint that ignores them, replaced with another search service, or
removed from an admitted Turn. A new Turn resolves the corrected declaration.
Automatic titles remain on Responses without search tools.

## Model-specific image input

DeepSeek Vision is enabled by the selected model's `input_modalities`, just like
vision models on other providers. Redeven authorizes and prepares staged image
bytes, then supplies them to Floret through `DeepSeekOptions.ResolveAttachment`.
Floret freezes native `input_image` data for estimation and dispatch. Text-only
models reject images. PNG, JPEG, GIF, and WebP use the same host attachment
limits and authorization checks as other native image routes.

Provider continuation state contains attachment descriptors and content hashes,
never image data URLs. A later preparation reauthorizes the current bytes and
rejects changed content. Prepared dispatch does not resolve the image again.
Redeven passes opaque state through without interpreting it or maintaining an
image/history mirror.

# Boundaries

Floret owns raw response items, including reasoning and historical opaque search results.
The host passes state through without interpreting or reconstructing it. Model
or surface changes invalidate continuation through the existing compatibility
boundary. Supplemental-context Turns retain Floret's no-state privacy boundary:
canonical conversation still replays, but ephemeral host context never becomes
provider continuation state. There is no host history mirror or Chat fallback.
The official guide still accepts historical `web_search_call` input from earlier
model responses. Reading that history is separate from declaring new search tools;
canonical records are not rewritten when the current capability is corrected.

# Evidence

- `redeven:internal/ai/model_gateway_deepseek.go` - Thin released-gateway adapter.
- `redeven:internal/ai/floret_provider.go` - Opaque state and request tool surface.
- `redeven:internal/ai/floret_runtime.go` - Catalog-owned Turn tool surface.
- `redeven:internal/ai/model_gateway_deepseek_test.go` - Historical receipt replay, aliases, images, and title isolation.
- `redeven:internal/ai/thread_model_switch_integration_test.go` - Turn surface switching and replay.
- `redeven:internal/ai/web_search_capability_test.go` - Rejection of ignored hosted tools.
- [Official request tools contract](https://api-docs.deepseek.com/api/create-response/)
- [Official Responses guide](https://api-docs.deepseek.com/guides/responses_api/)
- [Model and context runtime](model-context-runtime.md)

## Web operation presentation

Floret's public web Activity supplies search queries, open-page URLs,
find-in-page patterns, source availability, and bounded snippets. Flower renders
these same canonical facts live and after reopening a thread. Collapsed rows
identify the operation and target; expanded rows provide safe clickable source
links. An opaque completed operation has an explicit missing-details notice and
no empty disclosure. Explicitly empty lists are distinct from missing details.
Answer citations never become fabricated per-call search results.

Redeven's public Activity payload allowlist preserves `operation`, `url`,
`pattern`, and `results_provided` alongside the existing query and result fields.
Both live items and historical timeline blocks pass through this product
sanitizer; tests must cross that boundary rather than inject payloads directly
into the UI. Canonical records that already contain these facts need no migration
or repeat search when the public projection is corrected.

Desktop and Env App share [the web operation presentation](../../internal/flower_ui/src/WebSearchActivity.tsx).
The source list initially shows five entries, with keyboard-accessible expansion;
source titles, domains, full URLs, and two-line snippets support inspection.

The opt-in `TestE2E_FlowerDeepSeekV4WebResearchBoundary` qualification starts from
the production Service and normal Turn admission for Flash, Pro, and Vision.
It checks the unsupported model projection, accurate prompt, absence of search
tools on every request, a real successful `web_fetch` with verified page content,
staged Vision image input, and a restart follow-up. Run the existing DeepSeek
qualification script with a configured official credential. Normal CI uses
deterministic HTTP fixtures. Unsupported native search is not tested as though
it were available, and an assistant's verbal capability claim is never evidence.
