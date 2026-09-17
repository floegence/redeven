---
type: Runtime Contract
title: Managed Service release discovery and updates
description: Discover exact npm and OCI releases directly from configured sources, require explicit selection, and update with rollback.
quality_exception: Cross-domain release lifecycle contract spanning discovery, verification, installation, rollback, and UI selection states.
tags: [architecture, web-services, releases, npm, oci, updates]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

- Authority: the configured npm or OCI Registry owns source metadata; Redeven owns candidate validation, exact installed identity, updates, and rollback.
- Outcome: users inspect source releases, select one compatible identity, and deploy, upgrade, or downgrade without a Redeven version service.
- Invariants: recommendations are defaults only; discovery never installs; unavailable recommendations stay historical and cannot become implicit installs; Renderer submits opaque expiring IDs; operations revalidate their source; installed services retain hashed release identity.
- Failure boundary: discovery, authentication, compatibility, or update failure changes only its check or operation; the last healthy service and persisted last-success summary remain usable.

# Contract

## Candidate discovery

Schema-v2 `ReleaseCandidate` projects npm and OCI source, version or tag, publication time, channel, trust, compatibility, immutable identity, verification state, selectability, markers, and installed-release relation. Candidate rows use one deterministic order derived only from their immutable version or tag: exact SemVer values come first in descending semantic order and other values follow in descending lexical order. Publication metadata never reorders a visible row when asynchronous verification completes. Verified publication time remains authoritative for latest markers, with semantic version or date-like tag order as its deterministic fallback. Non-SemVer tags remain visible without being called latest. A moved tag is marked and never silently replaces the installed digest.

Template queries discover before installation; service queries use the installed snapshot and Secrets. One POST endpoint accepts `open`, `refresh`, `continue`, or `verify`. Opaque short-lived candidate and cursor IDs are scoped to source, identity, platform, and expiry and expose no credentials or Registry cursor. Create accepts `target_release_id`; omission selects the recommendation/default only after the built-in recommendation has been revalidated. If that recommendation is unavailable, the candidate remains visible as historical state with an unavailable status, no normal recommendation badge is shown, and explicit selection of a verified candidate is required; the UI and backend never fall back to the first or latest Registry result. Update requires explicit selection of a different application release. Update accepts only the resulting `update_plan_id` and new template Notice acknowledgements.

Ephemeral update-plan schema v4 prepares an exact release against the current compatible template. It rejects empty updates and records identities, advisory `risk_ids`, notices, stopped-state requirement, expiry, and `accepted_notice_revisions`. The latter contains only confirmations already stored by this service whose notice ID and revision exactly match the current template. New or revised required notices need explicit confirmation; advisory release risks never require acknowledgements. At operation admission the Manager merges exact saved confirmations with the submitted confirmations, rejects unknown or stale submitted revisions, and validates the complete current notice set. The merged set is committed with the successful release update; rollback retains the original configuration. No database schema changes or cross-service confirmation cache are involved.

The Manager revalidates source, scope, platform, expiry, template, current release, and stopped state before consuming the plan once. Aborted preparation cannot replace a cached plan after its request context is cancelled. Renderer submits no URLs, digests, or credentials. [Version interaction](managed-service-version-interaction.md) owns automatic preparation, inline review, and explicit operation submission.

The Manager waits 30–90 seconds after startup, checks every six hours and after install or update, and collapses matching bounded source requests. Conditional refresh uses ETag or Last-Modified and strips authorization on cross-origin redirects. Release-check schema v2 persists the source fingerprint, loaded tags, verified identities, completion state, last-success summary, and schedule, but never credentials, cursors, transient candidate IDs, or raw errors. A matching snapshot is restored with newly issued IDs after restart. Cancellation changes neither memory nor persistence; source failure preserves a last success as stale without blocking service actions or creating a toast.

## npm Host source and installation

TemplateSpec v6 Host declares an exact npm default, HTTPS Registry, executable, optional Secret-backed token, and non-secret environment. Discovery retains SemVer, deprecation, publication, dist-tags, integrity, and Node range. Invalid `sha512` or incompatible ranges remain visible but disabled. Tokens exist only in the request and a task-owned mode-0600 npm file, never persistent state, commands, logs, Hooks, or plaintext cache keys.

Installation verifies the managed Node artifact and stages one release directory. Redeven writes one private application manifest containing only the exact selected dependency, then installs `package@version` into that explicit prefix with a fixed hoisted layout, no lock, and scripts disabled. Managed npm commands use informational logging with interactive progress disabled; their stdout and stderr streams are fully drained before process completion, redacted, bounded, persisted in operation progress, and published to the active service disclosure. The package metadata and executable must verify in that same prefix before Redeven deletes temporary token configuration and runs the confirmed lifecycle rebuild. Redeven verifies the exact layout again after scripts, then verifies Registry integrity, the Node artifact, and the Runtime tree before atomic selection. The Runtime digest excludes the application subtree and Redeven-generated manifest and launcher entries, including the launcher's parent directory entry, while continuing to hash every other Node Runtime path. The final staged layout must pass the same verifier used when a later start or restart reuses the release, so an accepted installation is immediately reusable without repair or replacement. Hooks run only at declared positions. The foreground start script remains the launch owner and receives `REDEVEN_INSTALL_EXECUTABLE`.

npm lifecycle scripts execute with the current Environment user's authority and may access user-readable or writable data. The version surface presents this and non-recommended, preview, deprecated, downgrade, unknown-order, and moved-tag facts as concise advisory hints. They do not add checkbox gates; technical compatibility and stopped-state requirements remain authoritative backend checks.

## OCI source and selection

Single-container templates discover directly from their image repository; Compose is excluded because multiple image versions do not form one release identity. Distribution pages load at most 100 tags. Current and recommended tags are included in the first page so they can be verified promptly, while candidate rows use the deterministic version-or-tag order instead of Registry response or verification-completion order. Appended pages are merged into that same order, and later publication metadata updates the row in place without changing its position. The Renderer requests another page only when the user reaches the end of the loaded list, and verifies at most 20 visible or explicitly selected tags per batch; the Registry resolver uses at most four Manifest workers. “Latest” markers appear only after enumeration completes and are computed independently from display order. A cursor is consumed only after its page succeeds, so cancellation and temporary failure remain retryable. Every source request starts anonymously, including an anonymous Bearer challenge. Redeven reads Docker or Podman credentials only after the Registry rejects anonymous access, retries that exact request once, and gives a credential helper at most five seconds. A broken local helper therefore cannot delay a public Registry or outlive a bounded private-source request.

Unverified tags remain visible but cannot be submitted. Selection triggers exact Manifest and current Linux platform verification; a missing, incompatible, or malformed tag disables only that item. Authentication rejection, credential unavailability, repository absence, rate limiting, timeout, network failure, invalid response, and general source failure retain distinct safe codes. Install and update persist tag context plus exact platform digest, and update-plan creation revalidates only the chosen tag instead of rescanning the repository. When a built-in recommendation tag is gone but its declared platform digest remains verifiable, the candidate is labeled as a verified fixed image, never as a normal recommendation, and can be deployed only after explicit selection; the final revalidation uses the digest rather than the missing tag. A template install cannot close the version picker and silently continue with an invalid default: once a failed recommendation check is observed, the install action stays disabled until the user selects a verified candidate or closes the template flow.

## Update, downgrade, and recovery

`managed_service_update_v2` is the only update journal and records old and target state plus phase. Host updates verify a separate release directory before stopping; Container updates pull the target digest before replacement. The Manager starts, health-checks, and commits the target before removing the old Runtime. Failure restores the verified prior release and binding.

Interrupted recovery uses the v2 journal to finalize a healthy committed target or restore the old identity; no earlier decoder exists. SemVer downgrade and unknown-order switches require the service to be desired and observed stopped. The version surface explains that application data is not reverse-migrated without asking the user to sign off on the warning. Terminal failures are never auto-retried; the user refreshes candidates and creates a new plan.

Template recommendation, template revision, and release identity remain separate. Recommendation is presentation plus the new-install default. Template revision owns endpoint, mount, command, and security policy. ReleaseIdentity is the sole installed-version authority and owns npm version/integrity or OCI tag/digest/platform/source. A newer recommendation never rewrites an instance. The current template and persisted instance configuration define execution policy; changing the selected release does not replace instance overrides. The configuration contract owns applying template or instance changes.

The service API projects the installed release, recommendation, latest stable and preview releases, and source check status. The [version interaction contract](managed-service-version-interaction.md) owns the single-drawer selection, notice confirmation, stopped-state guidance, request feedback, and operation handoff.

# Boundaries

Redeven does not mirror packages, images, metadata, or credentials and does not promise Registry availability. Discovery does not auto-update, auto-restart, infer a latest non-SemVer tag, select another platform, combine Compose image versions, reverse-migrate application data, or trust a mutable source identifier as an installed identity. Private Registry support is limited to credentials already provided for that exact source.

# Evidence

- `redeven:internal/managedwebservice/release_discovery.go` - Persists, scopes, revalidates, restores, and schedules release candidates and summaries.
- `redeven:internal/managedwebservice/release_catalog.go` - Owns the open, refresh, continue, verify, cursor, candidate, and partial-failure state machine.
- `redeven:internal/managedwebservice/update_plan.go` - Creates, validates, expires, and consumes the single release-and-template update plan.
- `redeven:internal/managedwebservice/release_http_cache.go` - Enforces request collapse, conditional metadata caching, response bounds, credential scoping, and redirect policy.
- `redeven:internal/managedwebservice/npm_host.go` - Discovers npm metadata and installs and verifies isolated exact package releases.
- `redeven:internal/containerengine/registry_discovery.go` - Resolves paginated OCI tags, authentication challenges, manifests, platform digests, and stable errors.
- `redeven:internal/containerengine/registry_credentials.go` - Reads Docker and Podman credential stores and helpers without product persistence.
- `redeven:internal/managedwebservice/update.go` - Owns update-v2 staging, commit, rollback, and interrupted recovery.
- `redeven:internal/portforward/registry/schema.go` - Preserves the v1-v5 Registry lineage and atomically migrates release and operation documents.
- `redeven:internal/portforward/registry/release_checks.go` - Verifies and stores the last successful check summary.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Exposes permission-checked candidate and update-plan APIs.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Presents release identity, filters, local scrolling, localized source failures, advisory risk hints, and exact update selection.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.browser.test.tsx` - Verifies compact wide and narrow geometry plus real Playwright wheel input in both directions.
- `redeven:internal/managedwebservice/release_discovery_test.go` - Covers npm ordering, stale success, OCI pagination retry, pinned releases, restart restoration, authentication, redaction, range compatibility, and comparison.
- `redeven:internal/managedwebservice/update_test.go` - Covers recommendation, current-version retention, downgrade, risk, expiry, and restart-persisted status.
- `redeven:internal/containerengine/registry_discovery_test.go` - Covers OCI pagination, authentication, platform choice, digest verification, hostile links, limits, and cancellation.
- `redeven:internal/portforward/registry/registry_test.go` - Covers fresh v4 initialization, contiguous migration, release-summary preservation, rollback, drift, binding, and operation lineage.
