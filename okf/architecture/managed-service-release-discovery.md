---
type: Runtime Contract
title: Managed Service release discovery and updates
description: Discover exact npm and OCI releases directly from configured sources, require explicit selection, and update with rollback.
tags: [architecture, web-services, releases, npm, oci, updates]
timestamp: 2026-09-01T00:00:00Z
---
# Summary

- Authority: the configured npm or OCI Registry owns published metadata; Redeven owns candidate validation, consent, installed release identity, update execution, and rollback.
- Outcome: users can inspect all source releases, select one exact compatible identity, and deploy, upgrade, or deliberately downgrade without a Redeven version service.
- Invariants: discovery never installs automatically, Renderer submits only an opaque short-lived candidate ID, every operation revalidates the source, and an installed service always retains a hashed exact release identity.
- Failure boundary: source, authentication, compatibility, or update failure changes only the check or operation state; the last healthy service and last successful candidate result remain usable.

# Contract

## Candidate discovery

Schema-v1 `ReleaseCandidate` is the shared npm and OCI projection. It contains source, exact version or tag, publication time when available, stable/preview/special channel, deprecation, trust, platform compatibility, immutable integrity or digest, selectability, and a stable reason code. Candidate order is deterministic: npm and SemVer-like OCI tags use semantic version order; other OCI tags remain visible without being called latest. A mutable tag whose digest differs from the installed identity is marked as moved and never replaces the installed digest silently.

Template queries discover candidates before installation. Service queries use the installed snapshot and its existing Secret values. A candidate ID is an opaque, short-lived server token scoped to the template source, release identity, platform, and required risks; it does not expose Registry credentials or authorize another template. Create and Update accept `target_release_id`. Immediately before work starts, the Manager conditionally rereads the authoritative source and verifies the candidate identity, exact template scope, current platform, and acknowledgements. Renderer never submits raw download URLs, digests as authority, or Registry credentials.

The Manager waits a random 30–90 seconds after startup before the first background check, then checks every six hours. One process-wide metadata client collapses concurrent requests to the same credential-scoped source and uses `ETag` or `Last-Modified` for conditional refresh. Responses, redirects, bodies, concurrency, pages, and cache size are bounded. Authorization is stripped on cross-origin redirects. A failed refresh records a stable check error and time while preserving the last successful in-process result; it never blocks list, open, start, stop, or retry and does not create a notification toast.

## npm Host source and installation

TemplateSpec v3 Host may declare one npm package with an exact SemVer, absolute HTTPS Registry URL, executable, optional auth-token parameter that must reference a Secret input, and validated non-secret process environment. Packument discovery accepts bounded metadata, valid `sha512` integrity, deprecation, publication time, dist-tags, and a Node engine range that the managed Runtime can prove compatible. Unknown range syntax remains visible but disabled. Tokens exist only in the candidate request and a task-owned mode-0600 npm configuration file; they never enter a template, Registry record, command line, log, lifecycle Hook environment, or cache key in plaintext.

Installation first verifies the Redeven-managed Node artifact. It stages one version directory and runs npm with an exact `package@version`, no package lock, and scripts disabled. It deletes the token configuration before the explicitly confirmed rebuild enables lifecycle scripts. It then verifies the direct package version, Registry integrity, executable entry, Node artifact, and the complete managed Runtime tree before writing the manifest and atomically selecting that release. An install Hook runs only at its declared lifecycle position. The foreground start script remains the one launch owner and receives `REDEVEN_INSTALL_EXECUTABLE`.

npm lifecycle scripts execute with the current Environment user's authority and may access user-readable or writable data. Deployment, upgrade, and downgrade therefore require explicit acknowledgement. Preview and unreviewed-source risks require their own acknowledgements. The UI does not collapse these into one generic confirmation.

## OCI source and selection

Single-container templates discover directly from their configured image repository. Compose is excluded because independent image versions do not form one safe release identity. Discovery follows bounded Distribution pagination, supports Docker and OCI manifests and indexes, verifies returned manifest bytes against `Docker-Content-Digest`, and selects only the current `linux/amd64` or `linux/arm64` platform digest. It supports Basic and Bearer challenges and reuses current Docker or Podman credential stores and helpers without copying credentials into Redeven persistence.

All tags remain visible. Template policy may mark declared special tag prefixes non-selectable. Custom templates otherwise admit parsed, platform-compatible tags. Installation and update pull the exact platform digest and persist both tag context and immutable digest. Registry timeout, denial, rate limit, malformed or oversized response, cross-host pagination, digest mismatch, and missing platform return stable safe errors without raw response bodies.

## Update, downgrade, and recovery

`managed_service_update_v2` is the only update journal. It persists old and target release identities, template, configuration, RuntimeBinding, runtime identities, and the current phase. Host updates build and verify the target in a separate release directory before stopping the old process. Container updates pull the target digest before replacing the old container. The Manager then starts the target, checks health, commits the new identity and binding, and only afterward removes the old Runtime. A failure restores the previous release and binding when ownership can be verified.

Interrupted recovery reads the v2 journal and deterministically finalizes a healthy committed target or restores the old identity. No earlier journal decoder exists. Deliberate downgrade is allowed only when the service is both desired and observed stopped, and requires acknowledgement that Runtime rollback is supported but application data is not reverse-migrated. A terminal update failure is not automatically retried; the user must refresh candidates and select a release again.

Template revision and release identity remain separate. A template revision owns endpoint, mount, command, and security policy; release identity owns npm version/integrity or OCI tag/digest/platform/source. A newer template can be available without a newer source release, and a source release can be available without changing template policy. The service row signals an update only for a genuinely newer semantic version or a moved installed tag, not merely because older releases exist.

# Boundaries

Redeven does not mirror packages, images, metadata, or credentials and does not promise Registry availability. Discovery does not auto-update, auto-restart, infer a latest non-SemVer tag, select another platform, combine Compose image versions, reverse-migrate application data, or trust a mutable source identifier as an installed identity. Private Registry support is limited to credentials already provided for that exact source.

# Evidence

- `redeven:internal/managedwebservice/release_discovery.go` - Builds, caches, scopes, revalidates, and schedules release candidates and update hints.
- `redeven:internal/managedwebservice/release_http_cache.go` - Enforces request collapse, conditional metadata caching, response bounds, credential scoping, and redirect policy.
- `redeven:internal/managedwebservice/npm_host.go` - Discovers npm metadata and installs and verifies isolated exact package releases.
- `redeven:internal/containerengine/registry_discovery.go` - Resolves paginated OCI tags, authentication challenges, manifests, platform digests, and stable errors.
- `redeven:internal/containerengine/registry_credentials.go` - Reads Docker and Podman credential stores and helpers without product persistence.
- `redeven:internal/managedwebservice/update.go` - Owns update-v2 staging, commit, rollback, and interrupted recovery.
- `redeven:internal/portforward/registry/schema.go` - Persists exact release identity and RuntimeBinding in the fresh Registry baseline.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Exposes permission-checked template and service candidate APIs.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Presents release identity, filters, disabled reasons, risk consent, and exact update selection.
- `redeven:internal/managedwebservice/release_discovery_test.go` - Covers npm ordering, stale success, redaction, range compatibility, and update comparison.
- `redeven:internal/containerengine/registry_discovery_test.go` - Covers OCI pagination, authentication, platform choice, digest verification, hostile links, limits, and cancellation.
- `redeven:internal/portforward/registry/registry_test.go` - Covers fresh exact release, binding, and operation lineage persistence.
