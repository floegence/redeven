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

`Adapter.CallMethod` is the Redeven-side method dispatcher for future
ReDevPlugin capability route registration. It accepts a declared `Method` plus
raw JSON, requires `schema_version` to match the active capability contract,
decodes requests with unknown fields rejected, routes to the existing typed
adapter methods, and returns the same typed DTOs. This keeps JSON boundary
validation and method-to-DTO mapping in the business capability package rather
than duplicating it in future product route glue. It is not a manifest parser,
package validator, token issuer, or alternate ReDevPlugin method router.

`CLIClient` is the concrete local engine client. It shells out to Docker or
Podman with a bounded timeout, probes `version --format "{{json .}}"`, lists
containers through `ps --no-trunc --format json`, inspects one container through
`inspect`, executes container actions through explicit argv, pulls images, and
reads bounded non-follow log batches through `logs --timestamps`. `FollowLogs`
is a separate streaming hook that shells out to `logs --follow --timestamps`,
parses lines incrementally, and appends them to a caller-provided `LogLineSink`.
The default channel sink is fail-closed: a full sink returns stable
backpressure instead of buffering unbounded log data. Image pull also runs
through the same timeout-scoped command boundary, so parent context cancellation
and command timeout cancellation are propagated to the Docker/Podman helper.
The real process runner returns the context error after `exec.CommandContext`
terminates a command, preserving stable `context.Canceled` /
`context.DeadlineExceeded` semantics before future ReDevPlugin operation cancel
dispatch is wired in. The parser accepts Docker's newline-delimited JSON list
format and Podman's JSON array list format, prefers server/engine version fields
when probing status, converts Docker-like inspect payloads into the minimal
internal `EngineContainer` shape used by the adapter, parses pull digests when
the engine reports one, and parses timestamped log lines into stable millisecond
timestamps.

`TestCLIClientRealEngineSmoke` is an opt-in local integration smoke for real
Docker or Podman engines. It is skipped unless
`REDEVEN_CONTAINERS_ENGINE_SMOKE=1` is set, can be scoped with
`REDEVEN_CONTAINERS_ENGINE_SMOKE_ENGINES`, and defaults to a BusyBox image
unless `REDEVEN_CONTAINERS_ENGINE_SMOKE_IMAGE` overrides it. When enabled, it
pulls the image, creates a disposable container, verifies inspect/list/start,
observes a bounded log marker, verifies the real `FollowLogs` streaming path
can read the same marker and stop through context cancellation, restarts/stops
the container, and removes it with cleanup. This gives release and developer
machines a true engine smoke without making ordinary CI require a Docker or
Podman daemon.

`TestCLIClientRealEnginePullCancelSmoke` is a separate opt-in cancellation
smoke. It is skipped unless `REDEVEN_CONTAINERS_ENGINE_PULL_CANCEL_SMOKE=1` is
set, uses the same engine selector as the regular smoke, and defaults to a
non-routable registry reference unless
`REDEVEN_CONTAINERS_ENGINE_PULL_CANCEL_IMAGE` overrides it. When enabled, it
runs a real Docker or Podman `pull` through the CLI helper with a short timeout
and requires the command to stop with `context.DeadlineExceeded`. This proves
the local engine helper can cancel a live image pull process without depending
on the unreleased ReDevPlugin `OperationCanceler` route.

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
preserving risk flags. `TailLogs` remains bounded to at most 1000 non-follow
lines in this adapter, so plain request/response calls cannot accidentally
become unbounded subscriptions. Streaming is exposed only through the explicit
`FollowLogs` hook and requires a sink that owns backpressure and cancellation.
The released ReDevPlugin stream bridge must still own product route tickets,
stream-close audit, and client read semantics before the official Containers
plugin exposes follow logs to users. This preserves enough evidence for a
professional confirmation UI without turning the preflight plan into a secret
transport.

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
[10] redeven:internal/capabilities/containers/cli_client.go:107 - `TailLogs` rejects follow streaming and reads bounded timestamped batches.
[11] redeven:internal/capabilities/containers/cli_client.go:171 - Image pull returns a minimal image result and parses digest evidence when available.
[12] redeven:internal/capabilities/containers/cli_client.go:299 - Docker/Podman inspect payloads are converted into sanitized engine container metadata before public DTO mapping.
[13] redeven:internal/capabilities/containers/cli_client.go:352 - Container list parsing accepts Docker NDJSON and Podman JSON arrays.
[14] redeven:spec/capabilities/container-resources-v1.schema.json:1 - The machine contract is a JSON Schema under Redeven `spec/capabilities`.
[15] redeven:spec/capabilities/container-resources-v1.schema.json:421 - `start_preflight_plan` is closed-world and binds schema identity, method, request, target, runtime, risk, and admin fields.
[16] redeven:internal/capabilities/containers/preflight_test.go:14 - Tests verify start preflight redacts secret values and emits expected risk flags.
[17] redeven:internal/capabilities/containers/preflight_test.go:181 - Tests bind Go constants, method enums, response DTO fields, logs tail limits, required fields, and closed-world schema objects.
[18] redeven:internal/capabilities/containers/adapter_test.go:12 - Adapter tests cover engine resolution, unavailable requested engines, DTO mapping, secret redaction, actions, logs, image pull, and preflight use of inspected runtime metadata.
[19] redeven:internal/capabilities/containers/cli_client_test.go:10 - CLI client tests cover status version preference, Docker NDJSON, Podman arrays, Docker inspect runtime parsing, safe action argv, pull digest parsing, pull cancellation propagation, exec-runner context error preservation, bounded logs tail, follow-stream rejection, streaming argv, timestamp parsing, and sink backpressure.
[20] redeven:internal/capabilities/containers/testdata/generated_plugins/containers_integration/manifest.json:1 - The integration-only official Containers fixture declares the capability binding, product surface, method manifest, confirmation policy, and cancel policy expected for future ReDevPlugin registration.
[21] redeven:internal/capabilities/containers/manifest_fixture_test.go:114 - Fixture tests bind the manifest to `CapabilityID`, `CapabilityVersion`, `Methods()`, method effects, request fields, confirmation semantics, and cancel policies without importing ReDevPlugin code.
[22] redeven:internal/capabilities/containers/cli_client_integration_test.go:26 - The opt-in real engine smoke is gated by `REDEVEN_CONTAINERS_ENGINE_SMOKE` and validates Docker/Podman CLI behavior only when an engine is explicitly available.
[23] redeven:internal/capabilities/containers/method_dispatch.go:15 - `Adapter.CallMethod` maps raw JSON requests for each capability method to the typed adapter methods with schema-version and closed-world request checks.
[24] redeven:internal/capabilities/containers/adapter_test.go:211 - Dispatcher tests cover every method plus invalid schema versions, unknown fields, unknown methods, and missing request bodies.
[25] redeven:internal/capabilities/containers/adapter.go:64 - `LogLineSink` and the default channel sink define the bounded streaming handoff and stable backpressure error for follow logs.
[26] redeven:internal/capabilities/containers/adapter.go:273 - `Adapter.FollowLogs` exposes follow logs only through clients that implement the explicit streaming interface.
[27] redeven:internal/capabilities/containers/cli_client.go:138 - `CLIClient.FollowLogs` maps follow requests to explicit Docker/Podman argv and streams parsed log lines into the caller sink.
[28] redeven:internal/capabilities/containers/cli_client_test.go:225 - Streaming tests bind follow argv, timestamp parsing, and fail-closed sink backpressure.
[29] redeven:internal/capabilities/containers/cli_client_integration_test.go:215 - Real engine smoke validates `FollowLogs` against the running smoke container and requires cancellation to stop the follow command after the marker is observed.
[30] redeven:internal/capabilities/containers/cli_client_test.go:163 - Image pull cancellation tests prove parent context cancellation and CLI timeout cancellation reach the command runner.
[31] redeven:internal/capabilities/containers/cli_client.go:275 - `execRunner.Run` returns the context error after a real command is terminated by context cancellation.
[32] redeven:internal/capabilities/containers/cli_client_integration_test.go:63 - The opt-in real engine pull cancel smoke validates a live Docker/Podman pull process stops through CLI timeout cancellation.
