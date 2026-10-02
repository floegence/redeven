---
type: Architecture
title: Authorized platform model gateway
description: Session-scoped platform catalogs, credential boundaries, stable request identity, and background execution.
tags: [ai, platform, gateway, security]
timestamp: 2026-10-02T00:00:00Z
---
# Summary

Redeven AI uses the trusted control channel's platform lease and gateway origin to discover authorized models. The Runtime never receives a platform Provider API key. Floret continues to own thread execution, tools, canonical history, and recovery; the platform Edge owns authorization, binding, reservations, and final accounting.

# Contract

## Catalog and model selection

The Runtime renews the platform lease and loads the current authorized catalog for the session. The catalog is projected into request-local configuration, never persisted into the environment's editable provider profile. Public aliases become canonical `platform/` model IDs; wire requests carry the published public alias. Token bounds, image input, reasoning controls, and hosted web search come from this catalog. Each request is still authorized by the Edge.

Flower exposes platform models through a separate read-only `platform_model_source`. A platform-only environment needs no local provider configuration or key. The provider editor cannot edit this catalog. Environment, Desktop, and platform sources can coexist in the model menu. Default preferences are bounded, session-owner-scoped conveniences; thread model and reasoning settings remain durable. A removed model stays unavailable instead of silently switching an existing thread.

## Execution and trust

Only authoritative session metadata supplies the gateway origin and lease. Local provider base URLs cannot override them. HTTPS is required except for loopback testing. Execution sends thread, run, turn, prompt scope, trace, logical request, attempt, and epoch identities with the SDK-rendered native payload. Provider credentials, internal deployments, prices, and signed billing metadata never enter the Runtime request contract.

Chat and Responses use real SDK streaming, preserving reasoning, function calls, usage, finish state, images, and opaque continuation. Hosted web search is available only when the published Responses model authorizes it; the Edge owns its protocol, maximum call count, and billing. Runtime tool execution remains in Floret. Auxiliary title and compaction requests without upstream attempt IDs receive deterministic identities bound to their semantic requests, with output bounded by the authorized model limit.

Hosted output items map once into Floret call/result events even when repeated in the terminal snapshot; citations and reasoning remain observable. A platform stream without a terminal response or chat finish reason fails instead of reporting partial output as a successful completion. Explicit truncation retains its finish reason and continuation handle.

Browser transport cancellation closes the subscription rather than the background Run. Reconnection reads the same canonical execution, and reopening the Runtime history does not dispatch completed work again. Lease renewal rechecks live authorization; accounting recovery never retries a Provider execution. Refer to [Flower model and navigation presentation](../ui/flower-model-navigation.md) for source selection and [Flower storage ownership](flower-storage-ownership-and-migrations.md) for canonical persistence.

# Boundaries

The public Runtime does not configure LiteLLM, store its master key, settle bills, or select private deployments. The control plane publishes capabilities and the Edge enforces them. Provider-account file references and unsupported hosted tools cannot be enabled through a local profile. A catalog preference never bypasses live authorization.

# Evidence

- `redeven:internal/ai/platform_catalog.go` — request-local catalog and owner-scoped preference projection.
- `redeven:internal/ai/platform_gateway.go` — trusted origin, renewal, streaming, and native envelope.
- `redeven:internal/ai/floret_provider.go` — Floret identity and bounded auxiliary requests.
- `redeven:internal/ai/platform_gateway_lifecycle_test.go` — disconnect, resubscribe, and history reopen.
- `redeven:internal/ai/platform_gateway_wire_test.go` — cross-process HTTP contract against the Edge.
- `redeven:internal/ai/platform_auxiliary_test.go` — title, compaction, and deterministic identity.
- `redeven:internal/ai/platform_hosted_test.go` — hosted events, reasoning, citations, usage, and terminal evidence.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.setupGuide.browser.test.tsx` — platform-only browser readiness.
