---
type: Runtime Contract
title: Managed Service release discovery and updates
description: Discover exact npm and OCI releases directly from configured sources, require explicit selection, and update with rollback.
tags: [architecture, web-services, releases, npm, oci, updates]
timestamp: 2026-09-01T00:00:00Z
---
# Summary

- Authority: the configured npm or OCI Registry owns source metadata; Redeven owns candidate validation, exact installed identity, updates, and rollback.
- Outcome: users can inspect all source releases, select one exact compatible identity, and deploy, upgrade, or deliberately downgrade without a Redeven version service.
- Invariants: recommendation is only the no-choice default, discovery never installs automatically, Renderer submits only opaque short-lived IDs, operations revalidate their source, and installed services retain hashed exact release identity.
- Failure boundary: source, authentication, compatibility, or update failure changes only the check or operation state; the last healthy service and persisted last-success summary remain usable.

# Contract

## Candidate discovery

Schema-v1 `ReleaseCandidate` projects npm and OCI source, version or tag, channel, trust, compatibility, immutable identity, selectability, markers, and installed-release relation. SemVer-like values use semantic order; other tags remain visible without being called latest. A moved tag is marked and never silently replaces the installed digest.

Template queries discover before installation; service queries use the installed snapshot and Secrets. Opaque short-lived candidate IDs are scoped to source, identity, and platform and expose no credentials. Create accepts `target_release_id`; omission selects the recommendation/default. Update-plan omission retains the installed release while applying a newer template revision. Update accepts only the resulting `update_plan_id` and template Notice acknowledgements.

Ephemeral update-plan schema v2 combines an exact release with the latest compatible template revision. It rejects empty updates and records identities, revisions, advisory `risk_ids`, notices, stopped-state requirement, and expiry. The Manager revalidates the source, scope, platform, expiry, and stopped state before consuming the plan once. Release-risk acknowledgement fields do not exist. Renderer submits no URLs, digests, or credentials.

The Manager waits 30–90 seconds after startup, checks every six hours and after install or update, and collapses matching bounded requests. Conditional refresh strips authorization on cross-origin redirects. Verified latest identities and schedule are hashed and persisted; failure preserves the last success as stale without blocking service actions or creating a toast.

## npm Host source and installation

TemplateSpec v4 Host declares an exact npm default, HTTPS Registry, executable, optional Secret-backed token, and non-secret environment. Discovery retains SemVer, deprecation, publication, dist-tags, integrity, and Node range. Invalid `sha512` or incompatible ranges remain visible but disabled. Tokens exist only in the request and a task-owned mode-0600 npm file, never persistent state, commands, logs, Hooks, or plaintext cache keys.

Installation verifies the managed Node artifact, stages one release directory, and installs exact `package@version` with no lock and scripts disabled. It deletes temporary token configuration before the confirmed rebuild enables lifecycle scripts, then verifies package version, Registry integrity, executable, Node artifact, and Runtime tree before atomic selection. Hooks run only at declared positions. The foreground start script remains the launch owner and receives `REDEVEN_INSTALL_EXECUTABLE`.

npm lifecycle scripts execute with the current Environment user's authority and may access user-readable or writable data. The version surface presents this and non-recommended, preview, deprecated, downgrade, unknown-order, and moved-tag facts as concise advisory hints. They do not add checkbox gates; technical compatibility and stopped-state requirements remain authoritative backend checks.

## OCI source and selection

Single-container templates discover directly from their image repository; Compose is excluded because multiple image versions do not form one release identity. Bounded Distribution pagination verifies Docker/OCI manifest bytes and selects the current Linux platform digest. Basic/Bearer challenges may reuse Docker or Podman credentials without persistence. Credential-helper failure does not block public anonymous access and becomes diagnostic only after Registry denial. Authentication, rate limiting, and availability remain distinct failures.

All tags remain visible. Preview, special, and non-SemVer tags are selectable when identity and platform verify; other items show a disabled reason. Install and update persist tag context plus exact platform digest. Registry protocol, identity, limit, and platform failures return stable safe errors without raw bodies.

## Update, downgrade, and recovery

`managed_service_update_v2` is the only update journal and records old and target state plus phase. Host updates verify a separate release directory before stopping; Container updates pull the target digest before replacement. The Manager starts, health-checks, and commits the target before removing the old Runtime. Failure restores the verified prior release and binding.

Interrupted recovery uses the v2 journal to finalize a healthy committed target or restore the old identity; no earlier decoder exists. SemVer downgrade and unknown-order switches require the service to be desired and observed stopped. The version surface explains that application data is not reverse-migrated without asking the user to sign off on the warning. Terminal failures are never auto-retried; the user refreshes candidates and creates a new plan.

Template recommendation, template revision, and release identity remain separate. Recommendation is presentation plus the new-install default. Template revision owns endpoint, mount, command, and security policy. ReleaseIdentity is the sole installed-version authority and owns npm version/integrity or OCI tag/digest/platform/source. A newer recommendation never rewrites an instance. A newer template can be applied while retaining the current release, and a source release can be selected without changing template policy.

The service API projects current, recommended, latest stable, latest preview, check state and time, and current and available template revisions. The row makes the exact current release a direct version entry and shows source-latest hints only for a genuinely newer comparable release. The fixed-footer version drawer defaults a service to “keep current”; new deployment defaults to recommendation. It never selects the first source result automatically. Version risks use compact read-only text instead of checkbox acknowledgements. The drawer body and candidate list are explicit local wheel viewports, so mouse, trackpad, touch, and keyboard scrolling stay inside the drawer instead of reaching the Workbench canvas. Source errors are rendered from stable localized error codes rather than backend English messages.

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
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Presents release identity, filters, local scrolling, localized source failures, advisory risk hints, and exact update selection.
- `redeven:internal/managedwebservice/release_discovery_test.go` - Covers npm ordering, stale success, anonymous OCI fallback, authenticated OCI failure, identity visibility, redaction, range compatibility, and comparison.
- `redeven:internal/managedwebservice/update_test.go` - Covers recommendation, current-version retention, downgrade, risk, expiry, and restart-persisted status.
- `redeven:internal/containerengine/registry_discovery_test.go` - Covers OCI pagination, authentication, platform choice, digest verification, hostile links, limits, and cancellation.
- `redeven:internal/portforward/registry/registry_test.go` - Covers fresh exact release, binding, and operation lineage persistence.
