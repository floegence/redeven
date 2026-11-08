---
type: Architecture
title: Authorized platform model gateway
tags: [ai, platform, gateway, security]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven discovers authorized models via trusted control-channel lease/origin; Runtime never receives platform Provider keys. Floret owns execution/tools/history/recovery; platform Edge admission/binding/reservations/accounting. A removed model stays unavailable instead of silently switching an existing thread.

# Contract

## Catalog and model selection
The Runtime renews the platform lease and loads the current authorized catalog for the session. The catalog is projected into request-local configuration, never persisted into the environment's editable provider profile.

## Execution and trust
Only authoritative session metadata supplies the gateway origin and lease.

Refer to [Flower model and navigation presentation](../ui/flower-model-navigation.md) for source selection and [Flower storage ownership](flower-storage-ownership-and-migrations.md) for canonical persistence.

# Boundaries

The public Runtime does not configure LiteLLM, store its master key, settle bills, or select private deployments. Provider-account file references and unsupported hosted tools cannot be enabled through a local profile. A catalog preference never bypasses live authorization.

# Evidence

- `redeven:internal/ai/platform_catalog.go`
- `redeven:internal/ai/floret_provider.go`
