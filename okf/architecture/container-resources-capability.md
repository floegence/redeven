---
type: Architecture Contract
title: Container resources capability
description: Redeven-owned Docker and Podman business capability registered through the released ReDevPlugin host contract.
tags: [architecture, plugins, containers, capability]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

Redeven owns Docker and Podman access as a business adapter; ReDevPlugin owns
the plugin identity, permission, confirmation, operation, stream, quota,
revocation, and audit lifecycle around every call. The active capability is
`redeven.capability.container_resources@1.0.0`, described by the signed
`redeven.container_resources.v2@2.0.0` host-capability contract and consumed
through ReDevPlugin v0.6.10. Requests never enter a Redeven-local manifest,
token, operation, stream, or runtime protocol.

# Contract

## Published contract and official release

Redeven embeds a closed set of public, signed release artifacts under
`spec/redevplugin/`: the capability pin, schema, manifest, generated client,
compatibility metadata, notices, signature, official Containers plugin package,
release metadata, package signature bundle, revocation metadata, and public
signing key. Private signing material is not present in source or product
binaries.

Redeven also embeds a separate unsigned catalog distribution generated from the
same Containers package by removing only `signatures/package.sig`. Its package,
manifest, and entries hashes must equal the signed release content. Plugin Center
uses the immutable HTTPS URL for this artifact through the normal external
inspection and confirmation transaction. The result is unsigned, user-approved,
manual-update-only, Disabled, and has zero grants. The original signed release
artifact and strict release-ref verifier remain unchanged, and expired release
evidence continues to fail closed.

Startup verifies the capability bundle with ReDevPlugin's
`capabilitycontract.Verify`, registers the verified contract in a ReDevPlugin
`capability.Registry`, and exposes the official plugin through ReDevPlugin's
release module. Release identity, package hashes, signature key, source policy,
revocation epoch, host requirement, and exact capability pin are closed values.
The official package is installed and enabled through released Host APIs; it is
not unpacked or interpreted by Redeven.

## Business adapter

`internal/capabilities/containers` owns typed Docker and Podman DTOs, preflight
risk analysis, and the local CLI boundary. Docker and Podman remain distinct
engine identities. Container targets are the tuple `(engine, container_id)`,
and image targets are `(engine, image_ref)`; no request may collapse those
identities to a name or bare id. Every method requires the closed Docker or
Podman engine explicitly; the adapter never probes engines in preference order.

The adapter covers engine status, container list and inspect, start preflight,
start, stop, restart, remove, bounded/following logs, and image pull. DTOs are
minimal and do not expose raw inspect JSON, environment values, label values,
or sensitive host paths. Preflight reduces observed runtime state to stable
risk flags, redacted mount/device summaries, a target hash, risk level, and
admin requirement suitable for ReDevPlugin's risk-based confirmation flow.

`CLIClient` executes only explicit Docker or Podman argv with bounded command
duration and output. It accepts Docker NDJSON and Podman JSON-array list
formats, parses a minimal inspect shape, preserves context cancellation, and
terminates the command process group when cancellation or the 8 MiB output
limit is reached. Public adapter errors do not include argv, stderr, raw output,
tokens, secrets, URLs, or host paths.

Construction rejects nil and typed-nil engine clients before ReDevPlugin opens
any durable store. The CLI does not inspect localized stderr to guess a missing
container. Exact `CONTAINER_NOT_FOUND` comes only from a typed engine client;
logs failures deterministically map to `CONTAINER_LOGS_UNAVAILABLE` without
exposing engine text. Host-owned operation and stream terminal writes use a
finite independent deadline before integration close waits for tasks, and host
shutdown records active business work as canceled rather than failed.

## ReDevPlugin bridge

`internal/redevpluginintegration/containers_capability.go` is the thin product
bridge from ReDevPlugin's verified invocation contract to the typed business
adapter. It performs strict argument decoding, projects only contract-declared
response fields, maps business failures to the published capability errors,
and uses ReDevPlugin-owned operation and stream sinks.

Synchronous reads return projected data directly. Mutable methods register a
bounded in-flight business task under the Host-owned operation id and complete
the Host-owned operation sink exactly once. Log subscriptions append events to
the Host-owned stream sink. Cancellation validates both the operation id and
target method before canceling the task. Adapter close fences new work, cancels
all registered work, waits for task completion, and reports a stable terminal
failure if an asynchronous Host sink could not be finalized.

The task map is only an in-process cancellation bridge. It is not a durable
operation store, lifecycle authority, replay protocol, token issuer, audit
store, or alternate stream implementation.

## Interaction and placement

The official Containers UI is a signed ReDevPlugin surface. Redeven may place
the SDK-owned element in Activity or Workbench and may surround it with product
chrome and Workbench interaction markers, but it does not construct or reuse
the iframe, bootstrap document, bridge, asset session, or surface instance.
Activity and Workbench are host placement choices and never become capability
or plugin manifest fields.

Installation and enablement do not grant container access. The initial surface
calls engine-status and container-list methods, so an active `containers.read`
grant is required before open. Plugin Center projects that requirement from the
verified capability contract and lets an administrator grant or revoke it with
management, policy, and revoke-revision fences. Missing `containers.read` is a
permission state, not an engine connection error. Execute, delete, image-write,
and method-deny policy remain separate from the initial read requirement.

# Boundaries

- Identity, ownership scope, permissions, confirmation, tokens, quotas,
  operations, streams, audit, revocation, install/update, and runtime execution
  remain ReDevPlugin responsibilities.
- Docker/Podman discovery, argv construction, preflight inspection, and domain
  result mapping remain Redeven responsibilities behind the capability adapter.
- The signed capability contract is the wire authority. Redeven typed DTOs and
  projections must match it; Redeven must not publish a second schema or client.
- Official plugin and capability artifacts are generated and signed release
  inputs. Production code verifies their exact bytes and never regenerates,
  weakens, or substitutes them at runtime.
- Operation and stream work must finish through ReDevPlugin-owned sinks.
  Disable, uninstall, revocation, session teardown, and integration close must
  not leave detached container tasks active.
- A missing reusable platform behavior is fixed and released upstream before
  Redeven consumes it. No fallback bridge, local package parser, sibling
  checkout, or compatibility shim is allowed.

# Evidence

- `redeven:spec/redevplugin/artifacts.go:42` - The embedded set materializes closed signed release/capability bundles and the separately validated unsigned catalog package.
- `redeven:spec/redevplugin/catalog-containers-plugin/2.0.0/plugin.redevplugin` - Unsigned catalog distribution with release-identical logical content.
- `redeven:spec/redevplugin/official-containers-capability/host-capability.pin.json:1` - The pin fixes the v2 contract identity and every artifact hash.
- `redeven:spec/redevplugin/official-containers-capability/capabilities/redeven.container_resources.v2/v2.0.0/redeven.container_resources.v2.schema.json:1` - The signed machine contract defines closed methods, effects, permissions, confirmation, quotas, errors, operations, and subscription schemas.
- `redeven:internal/capabilities/containers/types.go:5` - Redeven business DTOs retain explicit engine and canonical resource identity.
- `redeven:internal/capabilities/containers/preflight.go:56` - Preflight derives a redacted, hashed risk plan from inspected runtime state.
- `redeven:internal/capabilities/containers/cli_client.go:32` - The CLI client owns bounded Docker/Podman process execution and parsing.
- `redeven:internal/capabilities/containers/cli_client_proc_unix.go:10` - Unix cancellation targets the isolated process group.
- `redeven:internal/redevpluginintegration/containers_capability.go:48` - The bridge verifies and registers signed capability artifacts before exposing the business adapter.
- `redeven:internal/redevpluginintegration/containers_capability.go:133` - Invocation dispatch uses ReDevPlugin capability inputs, operation sinks, and stream sinks.
- `redeven:internal/redevpluginintegration/containers_capability_test.go:19` - Tests bind registration, projection, contract validation, cancellation, streaming, terminal failures, and close behavior to verified artifacts.
- `redeven:internal/redevpluginintegration/release_module.go:51` - The official release module closes source policy, artifact resolution, capability pin, signing key, and revocation evidence.
- `redeven:internal/redevpluginintegration/release_module_test.go:107` - The official package is installed through the released ReDevPlugin HTTP lifecycle.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Projects `containers.read` as the exact initial-open requirement without collapsing other grants or policy.
