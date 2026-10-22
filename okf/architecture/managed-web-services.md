---
type: Runtime Contract
title: Managed Web Services
description: Operate generic Host, Container, and Compose services from the current verified external template definitions.
tags: [architecture, web-services, runtime, containers, security]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Redeven owns instance state, Runtime digests, bindings, resources, operations, and forwards; verified templates define behavior and the released catalog defines built-ins and assets.
- Outcome: every valid template uses one generic install, lifecycle, recovery, and uninstall engine without template-specific branches.
- Invariants: one Registry state authority, exact external-resource identity, explicit recovery actions, and Renderer use of backend capabilities.
- Failure boundary: invalid catalogs, bindings, resources, releases, permissions, and health checks fail closed without adopting or mutating unknown resources.

# Contract

## Catalog and installation
Redeven loads the released `github.com/floegence/redeven-service-templates` bundle before opening the Registry or starting the Manager.

With no version choice it installs the template's recommended/default release; an explicit compatible source candidate overrides that default, and later template edits never replace the installed release identity.

Failed creation removes only the verified new container, preserving retained volumes and the workspace for the next explicitly reviewed recovery.

## Runtime identity and operations
Every service has one canonical RuntimeBinding v2 plus SHA-256:

[Managed opening](managed-web-service-opening.md) owns launch-bound authentication preparation and separates opening failure from process health.

## Manual recovery
`ServiceView.actions`, status, and primary action are the backend's single presentation contract. Historical operation errors stay in recent history and never disable a currently healthy instance. See the canonical [management recovery contract](service-management-recovery.md).

## Persistence baseline
`portforward_registry_v2` schema version 6 preserves the permanent version-1 lineage for current-template resolution. A service row stores template ID, configuration, selected release, RuntimeBinding, workspace ownership, desired and observed state, protected Forward identity, managed Runtime identity, applied Runtime digest, artifact reference, and failure state; it stores no template revision, template snapshot, duplicated deployment, or service-family projection.

Version 2 adds the ordinary-forward default application path through that migration lineage; Managed Service opening continues to use its authoritative `open-session` result, as described in [Web Service browser sessions](web-service-browser-sessions.md).

# Boundaries

Redeven does not contain built-in service names, descriptions, notices, icons, template IDs, package identities, image identities, product-specific commands, or application-specific legacy adoption rules. It does not automatically upgrade discovered releases, infer ownership from live engine state, move application data, or manage credentials beyond the typed template parameter contract.

# Evidence

- `redeven:internal/managedwebservice/builtin_templates.go` - Loads and strictly maps the released external catalog.

- `redeven:internal/managedwebservice/runtime_resolution.go` - Resolves the current template with persisted instance state and computes the applied Runtime digest.

- `redeven:internal/managedwebservice/runtime_binding.go` - Defines and validates the sole current RuntimeBinding format.
