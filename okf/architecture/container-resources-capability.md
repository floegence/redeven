---
type: Architecture Contract
title: Container resources capability
description: Redeven-owned Docker and Podman business capability contract for future ReDevPlugin adapter registration.
tags: [architecture, plugins, containers, capability]
timestamp: 2026-07-04T00:00:00Z
---

Redeven owns the container resources capability as business-resource adapter
surface, not as plugin-platform core. The active v1 contract is
`redeven.capability.container_resources.v1` with capability id
`redeven.capability.container_resources`; it lives under `spec/capabilities/`
and `internal/capabilities/containers` rather than under `internal/plugins*` or
ReDevPlugin-owned `spec/plugin` paths.

# Mechanism

The contract covers Docker and Podman engines, container status/list/inspect,
start preflight/start, stop/restart/remove, logs tail, and image pull method
names. The JSON schema is closed-world and defines request/response DTOs,
minimal container summaries, inspect summaries, action results, bounded log
batches, image pull results, runtime summaries, target summaries, risk flags,
and the start preflight plan. The Go DTO constants and schema enum are bound by
tests so method names, schema identity, and object closure cannot drift
silently.

Redeven also carries an integration-only generated plugin fixture for the
official Containers experience under
`internal/capabilities/containers/testdata/generated_plugins/containers_integration/`.
That fixture models the expected ReDevPlugin manifest surface over this
business capability: one `container_runtime` capability binding, the exact
`Methods()` method set, read/write/execute/delete permission coverage,
risk-based confirmation for `containers.start`, required confirmation for
stop/restart/remove, subscription semantics for logs tail, and cancelable
operation semantics for mutable actions and image pull. The fixture is tested
against Redeven's Go constants and schema fields, but it is not a
ReDevPlugin platform parser, package schema, runtime bridge, or substitute for
consuming released ReDevPlugin artifacts.

`Adapter` is the Redeven-owned business adapter for this capability. It wraps
an `EngineClient`, resolves the first available local engine when the request
does not pin one, maps status/list/inspect/action/log/image results into the
public DTOs, and feeds observed inspect metadata into `BuildStartPreflightPlan`
for `containers.start` confirmation. `BuildStartPreflightPlan` validates the
selected engine and target container id, normalizes capability lists and
mount/device summaries, computes a stable `target_hash`, and returns image,
runtime, risk level, risk flags, `requires_admin`, and a short summary.

`CLIClient` is the concrete local engine client. It shells out to Docker or
Podman with a bounded timeout, probes `version --format "{{json .}}"`, lists
containers through `ps --no-trunc --format json`, inspects one container through
`inspect`, executes container actions through explicit argv, pulls images, and
reads bounded non-follow log batches through `logs --timestamps`. The parser
accepts Docker's newline-delimited JSON list format and Podman's JSON array list
format, prefers server/engine version fields when probing status, converts
Docker-like inspect payloads into the minimal internal `EngineContainer` shape
used by the adapter, parses pull digests when the engine reports one, and parses
timestamped log lines into stable millisecond timestamps.

`TestCLIClientRealEngineSmoke` is an opt-in local integration smoke for real
Docker or Podman engines. It is skipped unless
`REDEVEN_CONTAINERS_ENGINE_SMOKE=1` is set, can be scoped with
`REDEVEN_CONTAINERS_ENGINE_SMOKE_ENGINES`, and defaults to a BusyBox image
unless `REDEVEN_CONTAINERS_ENGINE_SMOKE_IMAGE` overrides it. When enabled, it
pulls the image, creates a disposable container, verifies inspect/list/start,
observes a bounded log marker, restarts/stops the container, and removes it
with cleanup. This gives release and developer machines a true engine smoke
without making ordinary CI require a Docker or Podman daemon.

The v1 preflight flags cover privileged containers, host network/PID/IPC
namespaces, host devices, added Linux capabilities, Docker or Podman socket
mounts, bind mounts, sensitive mount paths, secret-like environment variables,
secret-like labels, persistent restart policies, and image references that are
not digest-pinned. Critical and host-control risks require admin approval in
the plan, leaving ReDevPlugin confirmation and token enforcement to the
released platform contract when integration lands.

# Boundaries

Container DTOs are intentionally minimal. They do not expose raw inspect JSON,
raw command stdout, raw environment variable values, raw label values, or
sensitive host mount paths. Environment and label data are reduced to counts;
sensitive mount and device paths are replaced with a redacted marker while still
preserving risk flags. Logs tail is intentionally bounded to at most 1000
non-follow lines in this adapter; `follow=true` fails closed until the released
ReDevPlugin stream bridge owns backpressure and stream-close semantics. This
preserves enough evidence for a professional confirmation UI without turning the
preflight plan into a secret transport.

This contract is a Redeven-owned capability schema, not a ReDevPlugin platform
schema. Redeven may evolve the concrete Docker/Podman adapter and local CLI
client here, but plugin identity, lifecycle, permission, confirmation, token,
lease/quota, audit, and revocation checks must still be performed by released
ReDevPlugin artifacts before any container adapter method is called. If
integration needs a reusable platform behavior not represented by a released
ReDevPlugin contract, that behavior is added upstream first instead of copied
into Redeven.

# Citations

[1] redeven:internal/capabilities/containers/types.go:5 - The container resources schema and capability identifiers are Redeven-owned constants.
[2] redeven:internal/capabilities/containers/types.go:27 - The v1 method set covers status, list, inspect, start preflight/start, stop, restart, remove, logs tail, and image pull.
[3] redeven:internal/capabilities/containers/types.go:128 - Action, log, and image pull responses expose only minimal typed results.
[4] redeven:internal/capabilities/containers/preflight.go:56 - `BuildStartPreflightPlan` builds the typed start confirmation plan from observed container metadata.
[5] redeven:internal/capabilities/containers/preflight.go:174 - Mount summaries redact sensitive paths and classify Docker or Podman socket mounts.
[6] redeven:internal/capabilities/containers/preflight.go:260 - Start risk flags cover privileged, host namespace, device, capability, socket, bind mount, secret, restart, and digest risks.
[7] redeven:internal/capabilities/containers/adapter.go:90 - `Adapter` resolves engines and maps status, list, inspect, action, logs, image pull, and start preflight calls into the capability contract.
[8] redeven:internal/capabilities/containers/cli_client.go:32 - `CLIClient` implements the local Docker/Podman command boundary with timeout-scoped command execution.
[9] redeven:internal/capabilities/containers/cli_client.go:83 - Container actions are mapped to explicit Docker/Podman argv instead of shell strings.
[10] redeven:internal/capabilities/containers/cli_client.go:100 - Logs tail rejects follow streaming and reads bounded timestamped batches.
[11] redeven:internal/capabilities/containers/cli_client.go:131 - Image pull returns a minimal image result and parses digest evidence when available.
[12] redeven:internal/capabilities/containers/cli_client.go:296 - Docker/Podman inspect payloads are converted into sanitized engine container metadata before public DTO mapping.
[13] redeven:internal/capabilities/containers/cli_client.go:349 - Container list parsing accepts Docker NDJSON and Podman JSON arrays.
[14] redeven:spec/capabilities/container-resources-v1.schema.json:1 - The machine contract is a JSON Schema under Redeven `spec/capabilities`.
[15] redeven:spec/capabilities/container-resources-v1.schema.json:421 - `start_preflight_plan` is closed-world and binds schema identity, method, request, target, runtime, risk, and admin fields.
[16] redeven:internal/capabilities/containers/preflight_test.go:14 - Tests verify start preflight redacts secret values and emits expected risk flags.
[17] redeven:internal/capabilities/containers/preflight_test.go:181 - Tests bind Go constants, method enums, response DTO fields, logs tail limits, required fields, and closed-world schema objects.
[18] redeven:internal/capabilities/containers/adapter_test.go:12 - Adapter tests cover engine resolution, unavailable requested engines, DTO mapping, secret redaction, actions, logs, image pull, and preflight use of inspected runtime metadata.
[19] redeven:internal/capabilities/containers/cli_client_test.go:10 - CLI client tests cover status version preference, Docker NDJSON, Podman arrays, Docker inspect runtime parsing, safe action argv, pull digest parsing, bounded logs tail, and follow-stream rejection.
[20] redeven:internal/capabilities/containers/testdata/generated_plugins/containers_integration/manifest.json:1 - The integration-only official Containers fixture declares the capability binding, product surface, method manifest, confirmation policy, and cancel policy expected for future ReDevPlugin registration.
[21] redeven:internal/capabilities/containers/manifest_fixture_test.go:114 - Fixture tests bind the manifest to `CapabilityID`, `CapabilityVersion`, `Methods()`, method effects, request fields, confirmation semantics, and cancel policies without importing ReDevPlugin code.
[22] redeven:internal/capabilities/containers/cli_client_integration_test.go:21 - The opt-in real engine smoke is gated by `REDEVEN_CONTAINERS_ENGINE_SMOKE` and validates Docker/Podman CLI behavior only when an engine is explicitly available.
