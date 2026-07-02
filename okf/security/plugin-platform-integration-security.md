---
type: Security Contract
title: Plugin platform integration security
description: Redeven maps sessions, route ownership, permission caps, and business capabilities onto released ReDevPlugin security contracts.
tags: [security, plugins, permissions, local-ui]
timestamp: 2026-07-02T00:00:00Z
---

Redeven plugin security is host integration over released ReDevPlugin
contracts. ReDevPlugin owns plugin identity, lifecycle, permission evaluation,
dangerous confirmations, token and asset-ticket issuance, runtime leases,
broker enforcement, quota/revocation checks, and stable platform errors.
Redeven contributes the local session, product policy, route mounting, vault
adapter, audit/diagnostics sinks, and concrete business capability adapters.

# Mechanism

Redeven session metadata is authoritative only when it comes from the control
channel or the local direct-session path. Browser-provided permission or app
claims are not trusted input to plugin adapters. The current session metadata
surface contains `can_read`, `can_write`, `can_execute`, and a separate
`can_admin` management bit; `can_admin` is not part of the local RWX permission
clamp. A plugin integration must map those host facts into released ReDevPlugin
policy hooks instead of inventing Redeven-only plugin permission bits.

Route ownership is split by entrypoint. Local UI mounts the Env App appserver
under `/_redeven_proxy/*`, while direct sessions use the agent after the E2EE
handshake. Future plugin management, surface bootstrap, asset, and RPC routes
must be mounted through released ReDevPlugin handlers or thin Redeven wrappers
that preserve the appserver response shape. Redeven may preserve flat
`error_code` values from plugin-platform failures for product UI, but the error
catalog and platform semantics must remain released ReDevPlugin contracts.

Business capability adapters such as containers, files, shell, cloud services,
databases, vault access, or local product APIs begin after ReDevPlugin has
constructed the request context. The adapter receives a request that already
passed plugin identity, lifecycle, permission, confirmation, token or lease,
quota, revoke-epoch, and audit construction. Redeven product policy may narrow
or deny a capability; it must not mint plugin tokens, grant storage/network
access, or call the business adapter outside ReDevPlugin brokers.

# Boundaries

Redeven must not point builds, tests, release validation, examples, or committed
source at a local `../redevplugin` checkout through `go.work`, `go.work.sum`,
`replace`, local npm link/workspace/file/portal wiring, Rust path overrides,
copied source trees, or copied generated contracts. A ReDevPlugin integration
change is not ready until it consumes published Go, npm, runtime, schema, and
contract-hash artifacts.

Redeven must not implement an alternate plugin gateway token issuer, asset
ticket system, manifest parser, package validator, registry lifecycle, storage
broker, network broker, WASM executor, runtime supervisor, stream envelope, or
plugin lifecycle state machine. It must not directly edit ReDevPlugin registry
tables, package staging state, token rows, storage namespaces, runtime leases,
or revoke epochs.

Plugin surfaces and workers must not receive Desktop runtime-control tokens,
raw local direct-session artifacts, standalone Gateway bridge credentials, or
Flower target grants as ambient authority. Access to Redeven business resources
must always arrive through a released ReDevPlugin request context and a
Redeven-registered adapter.

# Citations

[1] redeven:AGENTS.md:256 - Redeven consumes ReDevPlugin through published artifacts only.
[2] redeven:AGENTS.md:331 - Local sibling checkout wiring and copied ReDevPlugin source are forbidden.
[3] redeven:AGENTS.md:354 - Redeven owns product integration, session mapping, policy, sinks, and business adapters.
[4] redeven:AGENTS.md:441 - ReDevPlugin platform state remains opaque to Redeven integration code.
[5] redeven:AGENTS.md:474 - Redeven integration must not bypass plugin tokens, brokers, sandboxing, or lifecycle policy.
[6] redeven:AGENTS.md:495 - ReDevPlugin upgrades in Redeven are published dependency changes, not source syncs.
[7] redeven:internal/session/types.go:7 - Session metadata is delivered by the control plane and browser claims are not trusted.
[8] redeven:internal/session/types.go:22 - `can_admin` gates management actions and is not part of the RWX clamp.
[9] redeven:internal/localui/localui.go:62 - The Env App appserver is mounted under `/_redeven_proxy/*`.
[10] redeven:internal/localui/localui.go:65 - Direct sessions are served by the agent after E2EE handshake.
[11] redeven:internal/codeapp/appserver/server_test.go:1070 - Management API tests forbid admin actions when `can_admin=false`.
[12] redeven:internal/envapp/ui_src/src/ui/services/localApi.localAccess.e2e.test.ts:193 - Local UI preserves flat appserver `error_code` values on HTTP failures.
