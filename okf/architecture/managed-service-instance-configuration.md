---
type: Architecture Contract
title: Managed Service Instance Configuration
description: Resolve the current template and instance overrides into one validated Runtime specification with journaled stopped-state reconfiguration.
tags: [architecture, web-services, containers, configuration, security]
timestamp: 2026-09-04T00:00:00Z
---
# Summary

- Authority: the current verified template owns the Runtime baseline; Redeven Runtime owns instance overrides, selected release, applied Runtime digest, Resource Plans, secrets, journals, and exact rebuilds; Renderer owns only an unsaved draft.
- Outcome: installed host, container, and Compose services expose typed settings without weakening template identities or bypassing the engine.
- Invariants: one resolver combines baseline and override; metadata commits separately; Runtime apply requires stopped state, current revision, an exact plan, and authoritative risk checks.
- Failure boundary: invalid or unverifiable settings fail before commit; a failed rebuild restores the prior release or records an explicit rollback error.

# Contract

# Configuration model

The current verified template definition is the only Runtime baseline. An installed instance stores its template ID but no template revision or snapshot. A canonical schema-versioned document stores only instance differences, accepted template notices, stable resource IDs, and the names of secret environment variables; its revision and SHA-256 are committed together. The resolver combines that document with current TemplateSpec, selected release identity, RuntimeBinding, secrets, and workspace parameters. Install, start, retry, update, reconfigure, recovery, verification, settings, and Open all use this same path; there is no snapshot execution path and no Renderer-owned preservation of hidden fields.

The selected application release remains fixed until the user explicitly chooses another verified release. Current template image or package recommendations may change the materialized Runtime contract but do not silently change that release. A canonical Runtime digest covers executable effective behavior and records what is applied to the managed resource. Template presentation or revision-only edits leave it unchanged; Runtime-relevant template, configuration, secret-presence, release, binding, or workspace changes make it stale and require the ordinary rebuild path.

The settings controller owns metadata and Runtime drafts but commits them independently. Name, description, and access mode update the service-owned protected forward without stopping the service. Runtime fields are deployment-aware:

- container: command, entrypoint, user, environment, labels, restart policy, workspace, bind, named volume, tmpfs, devices, CPU, memory, PID, shared memory, additional ports, network/PID/IPC modes, privileged, read-only root, capabilities, and security options;
- Compose: the same typed fields per existing service; service identity, topology, and image remain template-owned;
- host: install, start, stop, and uninstall scripts for custom templates. Built-in scripts remain locked and direct the user to duplicate the definition.

The UI uses one full-height settings drawer with stable sections, compact typed rows, directory selection for host paths, script editing, Compose service selection, persistent validation space, keyboard/focus behavior, reduced motion, and a fixed action footer. It explains every locked field instead of exposing unexplained disabled controls. Running services may edit a draft, but the action explicitly requests Stop; Redeven never stops or rebuilds in the background.

# Anchors and risks

Container images and digests, the primary Web port, loopback binding, Runtime or Compose-project identity, Redeven-reserved labels, and managed data-volume identities cannot be overridden. Stable `resource_id` values, not array indexes, bind mounts, ports, devices, and retained volumes to engine identities. Template updates keep valid instance overrides; removed or conflicting fields block update and require an explicit user decision.

Built-ins cannot enable host namespaces, devices, Docker sockets, arbitrary bind mounts, added capabilities, privileged mode, external ports, or weakened isolation. A user must duplicate the definition as a custom template, which removes its built-in and audited identity. For a custom instance, the Runtime classifies each newly introduced high-risk capability. External ports explicitly warn that they bypass the Redeven authorization proxy.

Preflight resolves the canonical candidate, asks `containerengine` for the normalized Resource Plan, and returns changed sections, exact risks, configuration revision, and a digest over configuration, secret-presence state, and engine plan. Apply recomputes it server-side. A stale revision, changed digest, missing acknowledgement, missing Admin authority, reserved label, changed anchor, or invalid typed value is rejected; UI checkboxes are not authority. Renderer code never constructs Docker argv or accepts raw Docker CLI input.

# Secrets and reconfigure

Secret environment values live only in a service-private `0600` file. The Local API reports only whether a value exists and supports explicit replacement or clearing. Values never enter configuration JSON, Resource Plans, service views, audit details, operation events, logs, or persisted Renderer state. Reconfigure stages old and target secret files privately so recovery can restore either exact release.

Runtime configuration applies only while desired and observed state are both stopped. One serialized `reconfigure` operation persists the old and target configuration, binding, resource identity, artifact, and Runtime digest in a journal; it verifies and removes the exact old Runtime, rebuilds the stopped target, verifies its complete image, resource, port, mount, device, security, and identity projection, then atomically commits the next revision and the digest of the Runtime actually built before clearing the journal. A custom host commits scripts without executing them; start, stop, and uninstall use them on their next action, while install runs only on an explicit reinstall path.

Failure removes an incomplete target, restores the old secret file, recreates and verifies the old Runtime, and leaves the old configuration authoritative. A rollback failure is preserved as an explicit service error rather than a half-applied success. On startup, an already verified target may be finalized. If the template changed after target verification, recovery proves the same managed Runtime identity and commits the journal's built digest rather than claiming it matches the newer template; a later lifecycle or Open action then performs one normal rebuild. Every earlier journal phase rolls back through the same driver. Cancellation terminates the owned engine operation before rollback.

# Boundaries

This contract does not change template images, Compose topology, the primary Web endpoint, ReDevPlugin, or public IPC. It does not accept raw engine commands, silently stop a running service, or grant a built-in unreviewed host authority.

# Persistence and API

`portforward_registry_v2` version 1 stores the template ID, configuration schema v2, revision and SHA-256, stable resource IDs, exact release identity, RuntimeBinding v2, applied Runtime digest, progress details, retry lineage, workspace ownership, deletion intent, and release-check schema v2 summaries. Runtime verifies each persisted document digest before typed policy validation, so serialization cannot become a second semantic identity. `managed_web_service_resources` is the only durable engine-resource source; no file marker or live-engine inference can create an alternate identity.

Every `portforward_registry_v1` version and other discarded pre-baseline kind has no decoder and is rejected read-only. After the user-approved v2 version-1 baseline is merged and released or distributed, its kind is permanent; every later configuration or Registry change must append a contiguous transactional edge that preserves user-owned records and validates the exact source and target shape.

The Local API additions are:

- `GET|PATCH /_redeven_proxy/api/managed-web-services/{id}/settings`;
- `POST /_redeven_proxy/api/managed-web-services/{id}/reconfigure/preflight`;
- `reconfigure` on the existing managed-service operation endpoint.

Reads require Web Service read authority. Metadata and Runtime mutation require read, write, and execute; high-risk plans additionally require Admin. Bodies are strict and bounded. ReDevPlugin and public IPC contracts do not change.

# Evidence

- `redeven:internal/managedwebservice/configuration.go` - Defines the override document, canonical identity, typed validation, and managed anchors.
- `redeven:internal/managedwebservice/runtime_resolution.go` - Owns current-template resolution, selected-release materialization, and applied Runtime digest identity.
- `redeven:internal/managedwebservice/settings.go` - Owns settings projection, secret redaction, candidate construction, Resource Plans, and risk classification.
- `redeven:internal/managedwebservice/reconfigure.go` - Owns journaling, stopped Runtime rebuild, exact verification, commit, rollback, and startup recovery.
- `redeven:internal/managedwebservice/custom_container.go` - Creates and verifies effective single-container resources and stable volume identities.
- `redeven:internal/managedwebservice/custom_compose.go` - Generates and verifies effective per-service Compose resources.
- `redeven:internal/portforward/registry/schema.go` - Defines the fresh exact Registry baseline containing configuration, resources, progress, bindings, and retry lineage.
- `redeven:internal/portforward/registry/managed.go` - Commits revisioned configuration and resource identities.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Enforces the settings, preflight, operation, permission, and bounded-audit boundary.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceSettingsDrawer.tsx` - Owns the deployment-aware settings interaction and draft state.
- `redeven:internal/managedwebservice/configuration_test.go` - Covers effective merge, normalized Compose, risks, typed resources, stable identity, and secret separation.
- `redeven:internal/portforward/registry/registry_test.go` - Covers fresh initialization, exact binding and retry persistence, drift, wrong kind, and future rejection.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.test.tsx` - Covers the drawer-to-preflight-to-shared-operation flow.
