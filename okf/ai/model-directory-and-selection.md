---
type: AI Configuration Contract
title: Model directory and selection
description: Read configured model metadata immediately and make Provider inventory refresh an explicit opt-in without changing user intent.
tags: [ai, models, providers, settings]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Runtime owns synchronization and atomic metadata snapshots. Reads and send preflight use shipped or saved metadata without waiting for supplier inventory. Failed or pending refresh never blocks configured chat. Background refresh is off by default, disclosed, and excludes OpenRouter. Adding OpenRouter/Ollama discovers their models; manual refresh remains available. Floret execution and storage contracts are unchanged.

# Contract

## One metadata owner
The Runtime loads `runtime/model-catalog` snapshots at initialization.

Static models resolve current shipped defaults when inventory is read, so old snapshots cannot pin stale capabilities; models absent from the current review require explicit capability configuration.

Cloud execution consumes its catalog protocol rather than fetching inventory during dispatch.

## Selection and availability
Provider profiles own selection, sparse overrides, custom definitions, and default identity separately from metadata. Row visibility never derives selection.

It changes presentation only, never stored identities or wire routing.

## Shared reads and settings
Both `GET /api/ai/models` modes return the same projection, including unfiltered `provider_catalogs` and backend `provider_defaults`. Defaults describe capabilities, never account availability, even before providers are configured.

With no usable model, configuration remains reachable and the input draft remains editable.

## Configuration and generated capabilities
`LoadForStartup` freezes supported legacy selections before services start. Startup never waits for discovery, and current profiles are not rewritten by migration.

No Floret schema migration is added.

# Boundaries

The Runtime owns inventory, snapshots, and authorized projections consumed by Desktop and Env App Flower adapters. This contract adds no Floret dependency or conversation store.

# Evidence

- `redeven:internal/ai/model_catalog_manager.go` - Single synchronization owner, scheduler, flights, deadlines, and publication.

- `redeven:internal/config/ai_model_snapshot.go` - Credential-scoped atomic snapshots and read-only Desktop projection.

- `redeven:internal/ai/provider_inventory.go` - Native authentication and complete pagination.
