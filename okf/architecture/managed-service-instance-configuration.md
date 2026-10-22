---
type: Architecture Contract
title: Managed Service Instance Configuration
description: Resolve the current template and instance overrides into one validated Runtime specification with journaled stopped-state reconfiguration.
tags: [architecture, web-services, containers, configuration, security]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: the current verified template owns the Runtime baseline; Redeven Runtime owns instance overrides, selected release, applied Runtime digest, Resource Plans, secrets, journals, and exact rebuilds; Renderer owns only an unsaved draft.
- Outcome: installed host, container, and Compose services expose typed settings without weakening template identities or bypassing the engine.
- Invariants: one resolver combines baseline and override; metadata commits separately; Runtime apply requires stopped state, current revision, an exact plan, and authoritative risk checks.
- Failure boundary: invalid or unverifiable settings fail before commit; a failed rebuild restores the prior release or records an explicit rollback error.

# Contract

The current verified template definition is the only Runtime baseline. A canonical schema-versioned document stores only instance differences, accepted template notices, stable resource IDs, and the names of secret environment variables; its revision and SHA-256 are committed together.

Running services may edit a draft, but the action explicitly requests Stop; Redeven never stops or rebuilds in the background.

Container images and digests, the primary Web port, loopback binding, Runtime or Compose-project identity, Redeven-reserved labels, and managed data-volume identities cannot be overridden.

Renderer code never constructs Docker argv or accepts raw Docker CLI input.

Secret environment values live only in a service-private `0600` file. Values never enter configuration JSON, Resource Plans, service views, audit details, operation events, logs, or persisted Renderer state.

Cancellation terminates the owned engine operation before rollback.

`portforward_registry_v2` version 5 retains the template ID, configuration schema v2, revision and SHA-256, stable resource IDs, exact release identity, RuntimeBinding v2, applied Runtime digest, progress details, retry lineage, workspace ownership, deletion intent, and release-check schema v2 summaries. Runtime verifies each persisted document digest before typed policy validation, so serialization cannot become a second semantic identity.

ReDevPlugin and public IPC contracts do not change.

# Boundaries

This contract does not change template images, Compose topology, the primary Web endpoint, ReDevPlugin, or public IPC. It does not accept raw engine commands, silently stop a running service, or grant a built-in unreviewed host authority.

# Evidence

- `redeven:internal/managedwebservice/configuration.go` - Defines the override document, canonical identity, typed validation, and managed anchors.

- `redeven:internal/managedwebservice/runtime_resolution.go` - Owns current-template resolution, selected-release materialization, and applied Runtime digest identity.

- `redeven:internal/managedwebservice/settings.go` - Owns settings projection, secret redaction, candidate construction, Resource Plans, and risk classification.
