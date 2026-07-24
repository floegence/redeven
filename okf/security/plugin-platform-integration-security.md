---
type: Security Contract
title: Plugin platform integration security
description: Redeven derives ReDevPlugin identity from authenticated sessions and keeps package source, signature, execution, update, route, runtime, and capability authority distinct.
tags: [security, plugins, permissions, local-ui]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

Redeven supplies authenticated host facts and source policy to ReDevPlugin; it
does not accept plugin ownership, authority, provenance, or trust from browser
payloads. Every HTTP route passes explicit authentication, origin, CSRF, and
closed-action authorization, and direct Host calls pass the same owner/action/
resource policy. External package source, signature, execution approval, update
eligibility, and permission are independent facts. Integrity failures, invalid
runtime identity, and capability scope mismatches fail closed.

# Contract

## Authenticated session boundary

The session resolver accepts only a Redeven channel id whose stored metadata
has exact non-empty channel, user, and environment identities. It derives:

- `owner_session_hash` from the active channel;
- `owner_user_hash` from the authenticated user;
- `owner_env_hash` from the environment endpoint;
- `session_channel_id_hash` from the active channel.

The resolver also intersects session RWX facts with Redeven's local permission
cap and carries admin separately for management. The bounded session cache is
keyed by owner-session hash and accepts a hit only when all four hashes match.
JSON, query, plugin IPC, release metadata, and capability arguments cannot
override any owner field.

Persistent state follows ReDevPlugin `user` or `environment` scope; short-lived
authority binds all four hashes. The released migration supplies the only active
owner-scoped generation and retains recognized unprovable legacy state in
quarantine. Unknown or invalid state blocks startup without mutation. Session
removal uses the released durable four-hash fence and drain, and Redeven removes
authentication only after exact acknowledgement. Guessed owner sweeps and local
teardown registries are prohibited.

## HTTP and direct authorization

The canonical route is `/_redevplugin/api/plugins`. AppServer delegates only an
access-checked Env route and attaches authenticated channel and same-origin facts
in server-only context. Other roles and null or missing origins are rejected.

The released handler then invokes four explicit steps:

1. `Authenticate` resolves the host session.
2. `ValidateOrigin` requires one exact non-null Origin equal to the server-bound
   trusted origin.
3. `ValidateCSRF` requires the exact `X-ReDevPlugin-CSRF` proof on every route
   whose released policy marks it required, including unsafe reads.
4. `AuthorizeRoute` accepts only a valid closed `RouteAction` permitted by the
   cached session.

Browser reads use released POST queries and retain Origin, CSRF, route-action,
and query-effect authorization. Redeven does not substitute Referer or Fetch
Metadata, inject Origin, or exempt queries.

Direct Host authorization checks the same action, resource, owner, and
permission. Missing or typed-nil security dependencies fail construction.
Method effect is resolved before local policy clamps it, while shared runtime
management remains admin-only.

## Permission management projection

Plugin Center reads active grants and explicit plugin security policies through
released ReDevPlugin APIs. It never writes registry tables, invents a default
grant for an official plugin, or treats official identity as permission.
Containers therefore remains unable to invoke its adapter until an
administrator explicitly grants `containers.read`; the UI identifies that state
before opening instead of misreporting it as a Docker connection failure.

Grant/revoke requests carry the exact current policy revision, management
revision, and revoke epoch. A CAS conflict or other failure causes inventory,
grants, and policy to be fetched again and requires a new user confirmation.
The client does not blindly retry. The active grant, permission allowlist cap,
and denied methods are separate facts: policy can narrow a grant, and a stale
grant remains revocable even when policy blocks its use.

Official catalog permission descriptions are product UX only. They may explain
the exact signed Containers permissions and which methods are needed for the
initial screen, but ReDevPlugin remains the grant, policy, revision, token
invalidation, and method-enforcement authority. Third-party requirements must
come from a released Host-verified capability-contract projection, not a
manifest claim or Redeven contract parser.

The requirements response is bound to the exact plugin instance, active
fingerprint, version, management revision, capability contract identity, and
contract hash. Product inventory and navigation use exact `inventoryKey` so a
catalog entry and installed external instances with the same plugin id cannot
select or mutate one another. Catalog presentation requires exact content
identity. The current version requires exact catalog version and all three
release hashes; a historical version requires an explicit catalog-trusted
official signing key, no external provenance, and registry hashes equal to
Host-verified hashes. Matching ids alone are not catalog identity. A current
external instance may therefore receive catalog presentation only when
publisher, plugin, version, and all three content hashes match exactly. Its
actual trust badge remains unchanged; only verified catalog trust may receive
the `Official` trust badge.

## Package admission and trust

The retained official release-ref install/update path accepts
only the exact official root delegation, channel policy and pointer, revocation
and pointer, signing-ledger checkpoint/evidence/proofs/receipts, publisher,
plugin, version, signed release metadata, package hashes, host requirement, and
capability contract pin. Committed and pending trust state, monotonic counters,
and locally signed append-only trusted time are durable. Unsigned input,
browser-supplied trust state, arbitrary package bytes, rollback, unknown
publisher, expired evidence, and invented fetch provenance are denied.

The current Plugin Center catalog action does not fall back around that boundary.
It opens the external-package transaction with a package URL pinned to the
immutable source commit. The referenced catalog artifact contains no package
signature and is admitted as `signature_absent`; generation and startup tests
require its package, manifest, and entries hashes to equal the verified official
release content. Explicit user confirmation produces `user_approved`,
`manual_only`, Disabled, and zero grants. The signed release artifact is not
rewritten, and a release-context signature is never reinterpreted as a generic
external-package signature.

The external-package path is separate from official release admission. A
validated public HTTPS package URL or GitHub Release is retrieved through the
released bounded fetcher and resolver; a local `.redevplugin` upload crosses the
same package validator and stage. Public HTTPS retrieval validates every DNS
result and redirect hop, pins the validated connection target while retaining
TLS hostname verification, strips cross-origin credentials, and bounds the
identity-encoded response before parsing. The browser cannot assert redirect
history, final origin, digest, or GitHub release identity.

Inspection freezes staged bytes and produces owner-bound source provenance,
signature assessment, execution approval, update eligibility, complete security
summary and hash, and a confirmation digest. The product shows those facts,
including permissions, capability methods, workers, network, storage, secret
references, core actions, intents, surfaces, and update changes, before commit.
Commit reopens and re-verifies the exact artifact and requires the matching
inspection id and confirmation digest. Query reconciles only the exact commit.
An unknown or in-progress mutation outcome marks the inspection query-only in
the product client. Timeout, cancellation, or a temporary query failure retains
that state; only a committed or failed terminal result clears it.

An absent, unknown-signer, or temporarily unavailable signature is not an
integrity failure, but it is also not trust. An administrator may explicitly
confirm installation; the result is disabled, has zero grants, and is eligible
only for manual update. Invalid and revoked signatures block commit and
execution. Verified, current signing evidence may raise trust and automatic
update eligibility, but signature status never grants permissions. Redeven does
not add a new official key, signing ledger, or authorization workflow; the
existing official release-ref verification remains unchanged.

## Runtime trust

Runtime descriptors bind version, target, IPC, WASM ABI, and artifact hash.
Handle grants also bind plugin fingerprint, runtime generation, owner audience,
method, resource scope, policy/management revisions, and revoke epoch. Linux
runtime evidence is rebuilt and verified from the attested source set; Darwin
must omit runtime bytes and evidence.

## Business adapter and observability boundary

Containers is invoked only after ReDevPlugin resolves lifecycle, permission,
confirmation, lease, quota, revocation, and audit context. Product code cannot
bypass that chain. Container identity includes engine; CLI output is bounded
before parsing, overflow terminates the process group, and public errors omit
argv, stderr, raw output, secrets, and paths. Terminal sink writes use a finite
independent deadline and truncated output is never accepted as success.

Audit, diagnostics, and public errors record stable component, operation,
failure code, correlation/request identity, and mutation outcome. Raw adapter
errors, tokens, secrets, cookies, query strings, absolute paths, and complete
URLs are not copied into public or durable diagnostic detail.

# Boundaries

Desktop runtime-control tokens, direct-session artifacts, Gateway credentials,
RCPP credentials, and Flower grants are not plugin ambient authority. A plugin
gets business access only through a released ReDevPlugin request context.

The platform boundary is defined by [ReDevPlugin host integration boundary](../architecture/redevplugin-boundary.md).
Redeven security adapters may narrow authority; they may not mint platform
tokens, weaken route policy, edit opaque state, or replace released brokers.

# Evidence

- `redeven:internal/redevpluginintegration/session_adapter.go:1` - Derives exact owner hashes and bounded permission cache entries.
- `redeven:internal/redevpluginintegration/security_adapter.go:1` - Implements the four-step web security contract.
- `redeven:internal/redevpluginintegration/adapters_test.go:1` - Covers origin, CSRF, session, and action denial.
- `redeven:internal/redevpluginintegration/release_module.go:1` - Enforces official source, signature, revocation, and capability pins.
- `redeven:internal/redevpluginintegration/integration.go:260` - Registers the released staged external-package source and assessment module.
- `redeven:internal/redevpluginintegration/external_package_test.go:24` - Proves unsigned upload inspection and explicit commit produce a disabled installed record.
- `redeven:internal/redevpluginintegration/release_module_test.go:1` - Proves expired official release evidence fails without a catalog record.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Binds runtime target, hash, IPC, ABI, leases, and Host services.
- `redeven:internal/redevpluginintegration/containers_capability.go:1` - Adapts authorized capability invocations to domain behavior.
- `redeven:internal/codeapp/appserver/server_test.go:810` - Covers canonical route reservation and origin delegation.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Restricts UI transport to the canonical same-origin namespace and attaches CSRF proof.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Reads grants and policies and submits revision-fenced permission mutations through the released client.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Keeps grants, allowlist caps, denied methods, and required-to-open methods distinct.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.tsx:1` - Presents immutable source, trust, security, and confirmation evidence before commit.
