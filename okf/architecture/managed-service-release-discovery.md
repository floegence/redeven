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
- Invariants: a template recommendation is only the no-choice default, discovery never installs automatically, Renderer submits only opaque short-lived plan or candidate IDs, every operation revalidates the source, and an installed service always retains its hashed exact release identity.
- Failure boundary: source, authentication, compatibility, or update failure changes only the check or operation state; the last healthy service and persisted last-success summary remain usable.

# Contract

## Candidate discovery

Schema-v1 `ReleaseCandidate` is the shared npm and OCI projection. It contains source, exact version or tag, publication time when available, stable/preview/special channel, deprecation, trust, platform compatibility, immutable integrity or digest, selectability, a stable reason code, current/recommended/latest markers, and its newer/same/older/unknown relation to the installed release. Candidate order is deterministic: npm and SemVer-like OCI tags use semantic version order; other OCI tags remain visible without being called latest. A mutable tag whose digest differs from the installed identity is marked as moved and never replaces the installed digest silently.

Template queries discover candidates before installation. Service queries use the installed snapshot and its existing Secret values. A candidate ID is an opaque, short-lived server token scoped to the template source, release identity, and platform; it does not expose Registry credentials or authorize another template. Create accepts `target_release_id`; omitting it selects the template recommendation/default. Updates never accept an unplanned target: `POST .../{id}/update-plans` accepts an optional candidate ID, and omission retains the installed application release while applying only a newer template revision. The update operation accepts only the resulting short-lived `update_plan_id` and reviewed notices and risks.

Plan creation overlays the explicit exact release, when present, onto the latest compatible template revision. It rejects an empty update and records current and target release, current and target revision, risks, notices, stopped-state requirement, and expiry. Immediately before creating the operation, the Manager rereads the source when a candidate was selected, verifies the candidate, current service, template revision, platform, plan expiry, and acknowledgements, then consumes the plan once. Renderer never submits raw download URLs, digests as authority, or Registry credentials.

The Manager waits a random 30–90 seconds after startup before the first background check, then checks every six hours and schedules an immediate check after install or update. One process-wide metadata client collapses concurrent requests to the same credential-scoped source and uses `ETag` or `Last-Modified` for conditional refresh. Responses, redirects, bodies, concurrency, pages, and cache size are bounded. Authorization is stripped on cross-origin redirects. Successful latest-stable and latest-preview identities, check time, next check, and SHA-256 are persisted. A failed refresh marks that summary stale while preserving it; it never blocks list, open, start, stop, or retry and does not create a notification toast.

## npm Host source and installation

TemplateSpec v4 Host may declare one npm package with an exact SemVer default, absolute HTTPS Registry URL, executable, optional auth-token parameter that must reference a Secret input, and validated non-secret process environment. Packument discovery retains every exact SemVer, deprecation, publication time, dist-tags, integrity, and Node engine range. Missing or invalid `sha512` integrity and unprovable or incompatible Node ranges remain visible but disabled. Tokens exist only in the candidate request and a task-owned mode-0600 npm configuration file; they never enter a template, Registry record, command line, log, lifecycle Hook environment, or cache key in plaintext.

Installation first verifies the Redeven-managed Node artifact. It stages one version directory and runs npm with an exact `package@version`, no package lock, and scripts disabled. It deletes the token configuration before the explicitly confirmed rebuild enables lifecycle scripts. It then verifies the direct package version, Registry integrity, executable entry, Node artifact, and the complete managed Runtime tree before writing the manifest and atomically selecting that release. An install Hook runs only at its declared lifecycle position. The foreground start script remains the one launch owner and receives `REDEVEN_INSTALL_EXECUTABLE`.

npm lifecycle scripts execute with the current Environment user's authority and may access user-readable or writable data. Deployment and update therefore require explicit acknowledgement. Non-recommended, preview, deprecated, downgrade, unknown-order, and moved-tag risks remain separate confirmations. The UI does not collapse these into one generic confirmation.

## OCI source and selection

Single-container templates discover directly from their configured image repository. Compose is excluded because independent image versions do not form one safe release identity. Discovery follows bounded Distribution pagination, supports Docker and OCI manifests and indexes, verifies returned manifest bytes against `Docker-Content-Digest`, and selects only the current `linux/amd64` or `linux/arm64` platform digest. It supports Basic and Bearer challenges and reuses current Docker or Podman credential stores and helpers without copying credentials into Redeven persistence.

All tags remain visible and no template policy can deny a version. Preview, special, and non-SemVer tags remain selectable when their manifest identity and platform can be verified; platform-missing or unverifiable items are disabled with a reason. Installation and update pull the exact platform digest and persist both tag context and immutable digest. Registry timeout, denial, rate limit, malformed or oversized response, cross-host pagination, digest mismatch, and missing platform return stable safe errors without raw response bodies.

## Update, downgrade, and recovery

`managed_service_update_v2` is the only update journal. It persists old and target release identities, template, configuration, RuntimeBinding, runtime identities, and the current phase. Host updates build and verify the target in a separate release directory before stopping the old process. Container updates pull the target digest before replacing the old container. The Manager then starts the target, checks health, commits the new identity and binding, and only afterward removes the old Runtime. A failure restores the previous release and binding when ownership can be verified.

Interrupted recovery reads the v2 journal and deterministically finalizes a healthy committed target or restores the old identity. No earlier journal decoder exists. Deliberate SemVer downgrade and every switch with unknown order are allowed only when the service is both desired and observed stopped. Downgrade requires acknowledgement that Runtime rollback is supported but application data is not reverse-migrated. A terminal update failure is not automatically retried; the user must refresh candidates and create a new plan.

Template recommendation, template revision, and release identity remain separate. Recommendation is presentation plus the new-install default. Template revision owns endpoint, mount, command, and security policy. ReleaseIdentity is the sole installed-version authority and owns npm version/integrity or OCI tag/digest/platform/source. A newer recommendation never rewrites an instance. A newer template can be applied while retaining the current release, and a source release can be selected without changing template policy.

The service API projects current, recommended, latest stable, latest preview, check state and time, and current and available template revisions. The row makes the exact current release a direct version entry and shows source-latest hints only for a genuinely newer comparable release. The fixed-footer version drawer defaults a service to “keep current”; new deployment defaults to recommendation. It never selects the first source result automatically.

# Boundaries

Redeven does not mirror packages, images, metadata, or credentials and does not promise Registry availability. Discovery does not auto-update, auto-restart, infer a latest non-SemVer tag, select another platform, combine Compose image versions, reverse-migrate application data, or trust a mutable source identifier as an installed identity. Private Registry support is limited to credentials already provided for that exact source.

# Evidence

- `redeven:internal/managedwebservice/release_discovery.go` - Builds, annotates, persists, scopes, revalidates, and schedules release candidates and summaries.
- `redeven:internal/managedwebservice/update_plan.go` - Creates, validates, expires, and consumes the single release-and-template update plan.
- `redeven:internal/managedwebservice/release_http_cache.go` - Enforces request collapse, conditional metadata caching, response bounds, credential scoping, and redirect policy.
- `redeven:internal/managedwebservice/npm_host.go` - Discovers npm metadata and installs and verifies isolated exact package releases.
- `redeven:internal/containerengine/registry_discovery.go` - Resolves paginated OCI tags, authentication challenges, manifests, platform digests, and stable errors.
- `redeven:internal/containerengine/registry_credentials.go` - Reads Docker and Podman credential stores and helpers without product persistence.
- `redeven:internal/managedwebservice/update.go` - Owns update-v2 staging, commit, rollback, and interrupted recovery.
- `redeven:internal/portforward/registry/schema.go` - Migrates Registry v1 to v2 and persists exact release identity separately from release-check summaries.
- `redeven:internal/portforward/registry/release_checks.go` - Verifies and stores the last successful check summary.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Exposes permission-checked candidate and update-plan APIs.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Presents release identity, filters, disabled reasons, risk consent, and exact update selection.
- `redeven:internal/managedwebservice/release_discovery_test.go` - Covers npm ordering, stale success, identity visibility, redaction, range compatibility, and comparison.
- `redeven:internal/managedwebservice/update_test.go` - Covers recommendation, current-version retention, downgrade, risk, expiry, and restart-persisted status.
- `redeven:internal/containerengine/registry_discovery_test.go` - Covers OCI pagination, authentication, platform choice, digest verification, hostile links, limits, and cancellation.
- `redeven:internal/portforward/registry/registry_test.go` - Covers fresh exact release, binding, and operation lineage persistence.
