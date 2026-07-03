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
minimal container summaries, inspect summaries, runtime summaries, target
summaries, risk flags, and the start preflight plan. The Go DTO constants and
schema enum are bound by tests so method names, schema identity, and object
closure cannot drift silently.

`Adapter` is the Redeven-owned business adapter for this capability. It wraps
an `EngineClient`, resolves the first available local engine when the request
does not pin one, maps list and inspect results into the public DTOs, and feeds
observed inspect metadata into `BuildStartPreflightPlan` for `containers.start`
confirmation. `BuildStartPreflightPlan` validates the selected engine and
target container id, normalizes capability lists and mount/device summaries,
computes a stable `target_hash`, and returns image, runtime, risk level, risk
flags, `requires_admin`, and a short summary.

`CLIClient` is the concrete local engine client. It shells out to Docker or
Podman with a bounded timeout, probes `version --format "{{json .}}"`, lists
containers through `ps --no-trunc --format json`, and inspects one container
through `inspect`. The parser accepts Docker's newline-delimited JSON list
format and Podman's JSON array list format, prefers server/engine version
fields when probing status, and converts Docker-like inspect payloads into the
minimal internal `EngineContainer` shape used by the adapter.

The v1 preflight flags cover privileged containers, host network/PID/IPC
namespaces, host devices, added Linux capabilities, Docker or Podman socket
mounts, bind mounts, sensitive mount paths, secret-like environment variables,
secret-like labels, persistent restart policies, and image references that are
not digest-pinned. Critical and host-control risks require admin approval in
the plan, leaving ReDevPlugin confirmation and token enforcement to the
released platform contract when integration lands.

# Boundaries

Container DTOs are intentionally minimal. They do not expose raw inspect JSON,
raw environment variable values, raw label values, or sensitive host mount
paths. Environment and label data are reduced to counts; sensitive mount and
device paths are replaced with a redacted marker while still preserving risk
flags. This preserves enough evidence for a professional confirmation UI
without turning the preflight plan into a secret transport.

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
[3] redeven:internal/capabilities/containers/types.go:184 - Runtime summaries expose environment and label summaries plus sanitized mounts, devices, and capabilities.
[4] redeven:internal/capabilities/containers/preflight.go:56 - `BuildStartPreflightPlan` builds the typed start confirmation plan from observed container metadata.
[5] redeven:internal/capabilities/containers/preflight.go:174 - Mount summaries redact sensitive paths and classify Docker or Podman socket mounts.
[6] redeven:internal/capabilities/containers/preflight.go:260 - Start risk flags cover privileged, host namespace, device, capability, socket, bind mount, secret, restart, and digest risks.
[7] redeven:internal/capabilities/containers/adapter.go:50 - `Adapter` resolves engines and maps status, list, inspect, and start preflight calls into the capability contract.
[8] redeven:internal/capabilities/containers/cli_client.go:30 - `CLIClient` implements the local Docker/Podman command boundary with timeout-scoped command execution.
[9] redeven:internal/capabilities/containers/cli_client.go:178 - Docker/Podman inspect payloads are converted into sanitized engine container metadata before public DTO mapping.
[10] redeven:internal/capabilities/containers/cli_client.go:231 - Container list parsing accepts Docker NDJSON and Podman JSON arrays.
[11] redeven:spec/capabilities/container-resources-v1.schema.json:1 - The machine contract is a JSON Schema under Redeven `spec/capabilities`.
[12] redeven:spec/capabilities/container-resources-v1.schema.json:347 - `start_preflight_plan` is closed-world and binds schema identity, method, request, target, runtime, risk, and admin fields.
[13] redeven:internal/capabilities/containers/preflight_test.go:14 - Tests verify start preflight redacts secret values and emits expected risk flags.
[14] redeven:internal/capabilities/containers/preflight_test.go:181 - Tests bind Go constants, method enums, required fields, and closed-world schema objects.
[15] redeven:internal/capabilities/containers/adapter_test.go:12 - Adapter tests cover engine resolution, unavailable requested engines, DTO mapping, secret redaction, and preflight use of inspected runtime metadata.
[16] redeven:internal/capabilities/containers/cli_client_test.go:10 - CLI client tests cover status version preference, Docker NDJSON, Podman arrays, and Docker inspect runtime parsing.
