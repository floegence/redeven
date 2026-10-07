---
type: Architecture Contract
title: Plugin package and runtime lifecycle
description: Qualify released plugin package sources, installation, runtime admission, and cache ownership through ReDevPlugin.
tags: [architecture, plugins, release, runtime]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

ReDevPlugin owns package trust, inspection, installation, runtime readiness, release cache, and durable lifecycle. Redeven supplies authenticated source policy, review presentation, and localized outcomes. Every source follows inspect, explicit confirmation, and released Host installation; unverified bytes, stale trust, missing runtime identity, or uncertain mutation outcomes fail closed.

# Contract

## Package sources and lifecycle

Production obtains catalog entries from the validated latest-only market
snapshot. A snapshot may identify an immutable release and signed transport,
but it does not carry package bytes or grant trust. Redeven opens a concise
review from signed presentation, source, version, and declared permissions.
Review performs no package parsing, signature verification, runtime preflight,
or lifecycle work. After confirmation, Redeven calls the released Host install
API and observes the Host-owned Execution and ordered Events. Publisher,
plugin, version, hashes, signatures, revocation evidence, source policy, and
Host requirements must match before ReDevPlugin changes the registry. Invalid,
revoked, or incomplete evidence fails closed.
Submission response loss is reconciled with the same request id and exact market
digests. A declaration mismatch refreshes the market before a new attempt.
Confirmed retained-data deletion treats an
already-absent binding as success and reconciles an unknown mutation outcome
against the exact generation and binding revision before reinstalling.
ReDevPlugin also preserves the deleted instance's durable revoke-epoch
floor across both retained-data and delete-data reinstalls. Previously issued
credentials therefore remain revoked, while the newly installed instance can
open surfaces with credentials minted at the current floor.

Official release installation is one Host-owned Execution with ordered Events,
one cancellation identity, and one cursor. Before confirmation Redeven uses
only market presentation, declared permissions, the exact release reference,
and binding digests. The Execution fetches and validates the release, trust,
hashes, signature, final manifest, capability contracts, and market declarations
before one enabled commit. Its stable product stages are
`download|verify|install|enable`; finer progress and retries remain platform
evidence. Execution survives UI or transport observation loss, and Redeven
never creates a local execution store or cancels work when a panel closes.
Market declarations provide permission id, required status, and
`read|write|delete|execute|admin` effects; Redeven localizes them without
parsing package bytes or treating them as final verification.

ReDevPlugin starts and health-checks the runtime and prewarms the exact worker
module after fresh install, update, downgrade, enable, and startup recovery.
A process Host opened before authentication now starts the admitted runtime and
prewarms validated installed Worker modules without waiting for an Env App
session. This preparation cannot invoke a Worker, create a lease, activate
connectivity, or publish a surface. Authentication and current permission,
release-trust, and runtime-generation checks still precede actual execution.
Host restart and explicit retry use the Host-owned recovery snapshot and
`recoverEnabled` path. Redeven observes and localizes the authoritative result;
it does not scan the registry to start workers, persist release trust,
activation evidence, recovery identities, or a second grant/trust state machine.

Redeven gives the released `remoterelease.DocumentCache` one disposable
`release-documents.sqlite` path under the selected plugin state root and closes
it after the Host and market controller stop. All immutable release transports
share it across process restarts. ReDevPlugin owns its schema, bounded storage,
SHA-256 and size checks, and fallback transport. A cache-open failure preserves
the existing file and uses remote verification. Cached bytes never substitute
for signature, expiry, revocation, source-policy, or authorization decisions.

Worker admission remains Host-owned. The released Host revalidates package
identity, SHA-256, Ed25519 status, revocation, grants, policy fences, runtime
identity, and session scope before publishing a runnable result; drift,
tampering, schema mismatch, stale fences, or invalid evidence fail closed.
Environment-scoped leases retain `owner_user_hash` in their signed audience
while the narrower resource scope omits it; the Host validates both bindings
before IPC. Recovery is source/channel single-flight, bounded to 15 seconds
(`recovery_timeout` is distinct from `recovery_canceled`), and a healthy new
session may take one fresh flight after an old leader ends. A canceled leader
cannot publish a lease.

The current-only v3 admission baseline accepts manifest v9 with `plugin_api=1`,
`internal_wire=1`, and the current UI and bridge contracts. The Host returns a
normalized signed catalog and resolves BCP 47 locale lookup; older metadata is
rejected read-only without compatibility parsing or an English fallback.

On Linux and Darwin the product-managed runtime is the released
`redevplugin-runtime` sibling, built from the attested manifest with Rust 1.88.0
(static PIE on Linux and the native Mach-O target on Darwin). ProcessManager owns launch, health, leases, hostcalls, shutdown, and restart;
startup never searches `PATH` or trusts field bytes. Worker execution is
optional: an explicit unsupported-kernel admission result leaves Env App
available without a fallback worker path. Missing identity, target, metadata, or
digest evidence still fails closed. Desktop installs managed runtime files with
private metadata and attestation; Host admission still applies.

An initial worker call also waits for Host-owned runtime readiness, exact worker
prewarm, and connectivity policy preparation before dispatch. Calls arriving
during startup share that preparation for the current plugin identity,
authorization revisions, and runtime generation. Cancellation or preparation
failure prevents dispatch; an already dispatched call is never retried. Surface
opening remains independent of worker readiness, so the plugin can render its
loading state while its first call waits without adding a Redeven readiness gate.

Administrators may also inspect packages from:

- a public HTTPS URL to a compatible `.redevplugin` package;
- a public GitHub repository Release, with an optional exact tag;
- a local `.redevplugin` upload.

Every source uses released `inspect -> explicit confirmation -> install`.
Inspection returns a process-local opaque id with a bounded TTL and binds package
bytes, source provenance, owner/session, intent, security summary, signature
assessment, execution approval, update eligibility, and confirmation digest.
Install presents the exact id and expected hash; the Host reopens and revalidates
the exact bytes/hash and enters its single atomic control-database transaction.
Redeven neither persists inspection/receipt/query state nor parses packages or
manufactures provenance or trust state.

Unsigned, unknown-signer, and temporarily unverifiable packages may be installed
after explicit confirmation and remain manual-update-only. Every successful
fresh install is persisted as enabled in the same Host transaction. Confirmation
does not silently grant permissions: missing or policy-blocked requirements are
projected as product attention, and the affected open or capability call returns
`permission_required` until the user grants access. Invalid or revoked
signatures are blocked. A later update remains bound to the installed instance and current
management revision. GitHub updates may reuse the stored public repository
identity; package-URL updates require the administrator to enter the URL again,
and upload updates require a new file selection. Redeven never reconstructs a
reusable URL from redacted provenance origin/path fields. A GitHub source without
an administrator-entered tag resolves the latest eligible Release on each new
inspection; the previously resolved release tag is evidence, not a new durable
user pin.

# Boundaries

Redeven does not parse plugin bytes, persist inspection receipts, implement a second install state machine, or start workers outside the released Host. Product review and runtime presentation remain separate from platform trust and durable lifecycle.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.
- `redeven:internal/redevpluginintegration/session_lifecycle.go:1` - Carries transient connection generation while the Host owns durable teardown.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Admits the released runtime and its fixed process manager contract.
- `redeven:scripts/check_redevplugin_release_artifacts.sh:1` - Verifies runtime and package release evidence.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and platform duplication.
- `redeven:internal/session/dependency_contract_test.go:1` - Matches downstream coordinates to the released manifest.
