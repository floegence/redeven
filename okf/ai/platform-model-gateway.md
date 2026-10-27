---
type: Architecture
title: Authorized platform model gateway
description: Session-scoped platform catalogs, credential boundaries, stable request identity, and background execution.
tags: [ai, platform, gateway, security]
timestamp: 2026-10-02T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven AI uses the trusted control channel's platform lease and gateway origin to discover authorized models. The Runtime never receives a platform Provider API key. Floret continues to own thread execution, tools, canonical history, and recovery; the platform Edge owns authorization, binding, reservations, and final accounting.

# Contract

## Catalog and model selection
The Runtime renews the platform lease and loads the current authorized catalog for the session. The catalog is projected into request-local configuration, never persisted into the environment's editable provider profile.

A removed model stays unavailable instead of silently switching an existing thread.

## Execution and trust
Only authoritative session metadata supplies the gateway origin and lease.

Refer to [Flower model and navigation presentation](../ui/flower-model-navigation.md) for source selection and [Flower storage ownership](flower-storage-ownership-and-migrations.md) for canonical persistence.

# Boundaries

The public Runtime does not configure LiteLLM, store its master key, settle bills, or select private deployments. Provider-account file references and unsupported hosted tools cannot be enabled through a local profile. A catalog preference never bypasses live authorization.

# Evidence

- `redeven:internal/ai/platform_catalog.go` — request-local catalog and owner-scoped preference projection.

- `redeven:internal/ai/floret_provider.go` — Floret identity and bounded auxiliary requests.
