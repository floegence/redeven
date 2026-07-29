---
type: Architecture Contract
title: Container resources capability
description: Expose endpoint-bound Docker and Podman resources through the released ReDevPlugin security and lifecycle contract.
tags: [architecture, plugins, containers, capability]
timestamp: 2026-07-29T00:00:00Z
---
# Summary

Redeven owns Docker and Podman resource semantics, CLI execution, redacted
domain DTOs, and risk projection. ReDevPlugin owns plugin identity, grants,
confirmation, operation and stream handles, quotas, revocation, and audit around
every call. Production remains pinned to the signed Containers `2.0.0` release
and `redeven.container_resources.v2@2.0.0` capability. The unsigned
`redeven.container_resources.v4@4.0.0` candidate adds opaque endpoint identity,
Docker Compose Projects, Podman Pods, and the redesigned Containers `4.0.0`
surface, but it is not registered or installable as an official release without
the authorized signing outputs. Unknown endpoints, stale plans, partial
inventory, and unavailable terminal reconciliation fail closed.

# Contract

## Release authority

The production artifact set under `spec/redevplugin/` contains a signed
capability pin, verified schema and generated client, compatibility metadata,
official plugin package, release metadata, package signature bundle, revocation
metadata, source policy, and public signing key. Startup verifies that exact v2
set with released ReDevPlugin APIs before registering the capability. Redeven
does not unpack the official plugin or implement an alternate package, token,
confirmation, operation, or stream protocol.

The v4 source contract, generated client, and plugin package are deliberately
stored under candidate paths. Candidate verification proves deterministic
generation, manifest v7, runtime `0.6.20`, `plugin-ui-v7`, exact method policy,
and absence of signatures or activatable capability routes. Merely committing
candidate bytes cannot make them trusted, stable, auto-update eligible, or
available to production plugins. An official v4 release requires authorized
capability and package signatures plus matching pin, root, source policy,
revocation, ledger, and release metadata. Redeven must not create a substitute
key or activate an unsigned contract.

## Endpoint and resource identity

Every v4 resource target binds `(engine, endpoint_id, resource identity)`.
`endpoint_id` is an opaque Host projection over a Docker context or Podman
connection. The plugin may submit only an ID from current Host inventory; it
cannot provide or recover a socket, URL, certificate, configuration path, or
CLI context name. The adapter resolves the ID again before reads, preflight,
mutation, stream creation, and reconciliation, so a syntactically valid forged
ID is not enough to obtain a plan or execute work.

Docker commands always include the Host-resolved `--context`. Podman commands
use the Host-resolved `--connection` when applicable and project local or remote
plus rootless or rootful state. Selecting an endpoint changes only the plugin
workspace and never invokes `docker context use`, edits Podman configuration, or
changes a user's global CLI default. Endpoint DTOs expose only opaque identity,
display name, default state, reachability, engine version, engine type, and safe
Podman mode metadata.

Containers, images, volumes, Compose Projects, Pods, preflight requests,
operations, streams, and terminal reconciliation all retain the exact engine
and endpoint. Container list projection may expose a safe Compose Project or
Pod relationship, but does not expose arbitrary label values or raw inspect
JSON. Pod and container membership uses canonical IDs rather than name matching.

## Resource coverage

The signed v2 adapter supports engine status, container list and inspect, start
preflight, start, stop, restart, remove, bounded or following logs, and image
pull. The immutable v3 candidate added typed creation, pause, unpause, kill,
statistics, image management, and volume management. V4 makes the complete set
endpoint-aware and adds endpoint discovery and health.

For Docker, v4 lists and inspects already-existing Compose Projects and can
start, stop, restart, or bring down an exact project. Project configuration
paths remain Host-internal. The capability never uploads, edits, returns, or
parses user Compose YAML, and Compose down never adds `--volumes`.

For Podman, v4 lists and inspects Pods and can create, start, stop, restart, or
remove an exact Pod. Pod deletion uses the delete grant and exact confirmation;
creation and lifecycle use the execute grant. Docker-only methods reject Podman
targets and Podman-only methods reject Docker targets.

Permissions remain intentionally coarse and stable: `containers.read` covers
endpoint and inventory reads, `containers.execute` covers lifecycle and resource
creation, `containers.image.write` covers image writes, and
`containers.delete` covers remove, prune, Compose down, and Pod remove. Method
deny policy remains independent from these grants.

## Mutation and data safety

Every confirmation-bound mutation declares a paired structured preflight whose
request contains the operation request fields. ReDevPlugin recomputes the plan
and binds the request, exact target, confirmation intent, Host-owned
`request_hash`, and `plan_hash`. A displayed `plan_digest` is evidence for the
user and never becomes plugin-provided authorization.

Image and volume prune plans return a normalized, non-empty exact identity set.
Execution revalidates each member and performs identity-specific removal rather
than a broad runtime prune. Authoritative inventory after the attempt must prove
which members remain. Changed references, duplicates, partial completion, or
unavailable inventory produce a stale plan or unknown outcome, retain the
resource lock, and block blind replay.

DTOs never expose raw inspect output, environment values, label values,
credentials, socket paths, remote URLs, certificates, or host configuration
paths. Preflight reduces runtime state to stable risk flags, redacted
mount/device summaries, exact target identity, risk level, administrator
requirement, and operation impact. Public errors omit argv, stderr, raw output,
tokens, URLs, and host paths.

The CLI boundary runs only explicit Docker or Podman argv with bounded duration
and output. It preserves context cancellation, terminates the process group on
cancellation or output overflow, and parses only the minimal supported JSON or
NDJSON shapes. It does not inspect localized stderr to invent typed resource
identity errors.

## ReDevPlugin bridge

The Redeven integration bridge strictly decodes contract-declared inputs,
projects contract-declared outputs, maps typed business failures, and completes
ReDevPlugin-owned operation or stream sinks. Mutable methods register bounded
in-flight business work under the Host operation ID. Cancellation validates the
exact operation and target method. Integration close fences new work, cancels
registered tasks, waits for completion, and records stable terminal results.
The in-process task map is not a durable operation store, replay protocol,
lifecycle authority, audit store, or token issuer.

The v4 bridge and generated client are exercised against the unsigned source
contract, but startup does not construct or register a verified v4 capability.
This is the required fail-closed boundary until authorized release artifacts
exist.

## Product surface

Activity and Workbench remain Redeven placement choices around one SDK-owned
sandboxed surface. Redeven does not construct or reuse the iframe, bootstrap
document, bridge, asset session, or surface instance. Installation and
enablement never imply grants; initial v4 loading requires `containers.read` to
list endpoints, inspect the selected endpoint, and load the endpoint-bound
resource inventories.

The v4 surface opens on Overview. Desktop uses a 168 px resource navigation,
compact tablet layout uses a 56 px icon navigation, and mobile uses a top
resource selector with full-screen detail drill-in. Containers, Images, and
Volumes are always available; Docker adds Projects and Podman adds Pods. The
context bar shows engine, opaque endpoint display name, reachability, version,
and Podman rootless or rootful mode. Resource workspaces use dense tables and a
detail inspector rather than the historical flat-card layout. Search is NFKC
normalized, selection and filtering stay endpoint-scoped, and destructive
actions are disabled when inventory is stale, partial, or unavailable.

# Boundaries

- ReDevPlugin owns identity, permission, confirmation, operation, stream,
  quota, audit, revocation, installation, and runtime lifecycle.
- Redeven owns Docker and Podman discovery, explicit argv, business DTOs,
  preflight risk projection, resource reconciliation, and product UI.
- The signed capability contract is wire authority; Redeven does not publish a
  second schema or edit generated ReDevPlugin contracts in place.
- Official package and capability artifacts come only from the authorized
  signing flow. Candidate artifacts remain non-activatable.
- Missing reusable platform behavior must be released upstream first; no local
  bridge shim, sibling checkout, copied protocol, or alternate runtime is
  allowed.

# Evidence

- `redeven:spec/capabilities/container-resources-v4.contract.json` - Defines the unsigned endpoint-aware v4 capability source.
- `redeven:spec/redevplugin/candidate-containers-capability/capabilities/redeven.container_resources.v4/v4.0.0` - Contains deterministic generated candidate schema, client, compatibility metadata, and notices without an activatable signature pin.
- `redeven:internal/capabilities/containers/resources_v4.go` - Defines endpoint-aware business DTOs and adapter behavior.
- `redeven:internal/capabilities/containers/resources_v4_cli.go` - Resolves opaque endpoints and constructs explicit Docker context and Podman connection commands.
- `redeven:internal/capabilities/containers/resources_v4_test.go` - Proves opaque endpoint binding, Compose volume retention, Pod confirmation, and rootless projection.
- `redeven:internal/redevpluginintegration/containers_capability_v4.go` - Dispatches v4 requests through ReDevPlugin-owned invocation, operation, and stream contexts.
- `redeven:scripts/check_containers_plugin_v4_candidate.sh` - Rebuilds and validates the fail-closed v4 contract and plugin package.
- `redeven:spec/redevplugin/official-containers-capability/host-capability.pin.json` - Pins the currently active signed v2 capability.
- `redeven:internal/redevpluginintegration/release_module.go` - Closes the current official package source, signature, revocation, and capability pin.
- `redeven:plugins/official/containers/src/controller.ts` - Owns endpoint, workspace, stream, dialog, and operation state for the redesigned surface.
