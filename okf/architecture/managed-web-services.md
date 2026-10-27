---
type: Runtime Contract
title: Managed Web Services
description: Operate generic Host, Container, and Compose services from the current verified external template definitions.
tags: [architecture, web-services, runtime, containers, security]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven owns service instances, bindings, resources, operations and protected forwards; verified external templates define behavior. One generic engine handles Host, Container and Compose installation, lifecycle, recovery and uninstall. Registry state and exact resource identity are authoritative. Invalid catalog, release, ownership, permission or health facts fail closed without adopting unknown resources.

# Contract

- Load the released `redeven-service-templates` catalog before Registry/Manager startup. Default installation uses its recommendation unless an explicit compatible candidate is selected; later template changes cannot replace installed release identity. Failed creation removes only the verified new container, preserving data/workspace for reviewed recovery.
- RuntimeBinding v2 and SHA-256 identify Host install/data/log paths, Container name or Compose project/config root. [Managed opening](managed-web-service-opening.md) owns launch authentication and separates opening failure from health.
- Backend `ServiceView.actions`, status and primary action drive presentation; historical errors never disable healthy instances. [Management recovery](service-management-recovery.md) owns explicit actions.
- `portforward_registry_v2` schema 6 preserves the v1 lineage. Persist template ID, configuration, exact release/binding/digest, workspace/resource ownership, desired/observed state, protected Forward, artifact and failures—not template snapshots/revisions or duplicated deployments. Schema 2 added ordinary-forward paths; managed opening uses `open-session` ([browser sessions](web-service-browser-sessions.md)).

# Boundaries

No built-in service identities, copy, assets, commands or application-specific adoption logic live here. Never auto-upgrade releases, infer ownership from engine state, move application data or exceed typed template credential policy.

# Evidence

- `redeven:internal/managedwebservice/builtin_templates.go` - Loads and strictly maps the released external catalog.

- `redeven:internal/managedwebservice/runtime_binding.go` - Defines and validates the sole current RuntimeBinding format.
