---
type: Validation Guide
title: Control-plane capacity qualification
description: Measure ten thousand enrolled Runtime control sessions with real authority, recovery, and signed Gateway requests.
tags: [gateway, controlplane, validation, performance]
timestamp: 2026-10-13T00:00:00Z
---
# Summary

Control-plane capacity qualification measures ten thousand enrolled Runtime sessions through real Nginx/TLS, MySQL, and canonical authority decisions. The harness uses production heartbeats, signed Gateway observations, and credential recovery. A full acceptance result combines client latency and recovery counts with independent server CPU, RSS, database, queue, and challenge-backlog measurements.

# Contract

The independent load host runs `scripts/run_controlplane_capacity.sh manifest.json private-results`. Build the committed embedded UI assets first using the repository's Node 26 and published dependency workflow. The harness uses the production Agent control lifecycle, Gateway observer, registration, heartbeat policy, artifact source, durable spend ledger, pool top-up, Gateway proof signing, and Flowersec connection controller. It does not replace authority decisions, introduce another reconnect loop, or forward application data.

The manifest contains real enrolled Runtime config paths. Enroll separate test machines through the normal Cloud/Gateway approval flow, preserve their certificate and identity isolation, and copy their configurations to a restricted load-host directory. The configs must contain currently valid artifact pools. Gateway processes remain active on their own test hosts to synchronize their real member directories. Do not share identities or source configs between concurrent runs. The output directory contains live credentials and spend state and must remain private with mode 0700.

```json
{
  "scenario": "steady",
  "duration_seconds": 7200,
  "startup_rate": 150,
  "ca_file": "/private/test-root.pem",
  "runtime_configs": ["/private/runtime-00001/config.json"],
  "environment": {
    "region": "8 vCPU / 16 GiB, commit and image digest",
    "control_cell": "8 vCPU / 16 GiB, commit and image digest",
    "database": "independent 8 vCPU / 32 GiB, SSD, MySQL version",
    "load_host": "independent host, CPU and memory",
    "nginx": "version, TLS endpoint and deployed configuration",
    "heartbeat_interval_ms": 10000,
    "distribution": "one runtime per Gateway"
  },
  "gateways": [],
  "http": [
    {
      "name": "environment_query",
      "method": "GET",
      "url": "https://region.example/api/srv/v1/environments",
      "cookie_file": "/private/refreshed-cookie.txt",
      "rps": 500
    },
    {
      "name": "session_init",
      "method": "POST",
      "url": "https://region.example/v1/channel/init?endpoint_id=actual-env-id",
      "cookie_file": "/private/refreshed-cookie.txt",
      "headers": {"Origin": "https://region.example", "Content-Type": "application/json"},
      "body": {"endpoint_id":"actual-env-id","floe_app":"com.floegence.redeven.agent"},
      "rps": 50
    }
  ]
}
```

The illustrative single config must be replaced with at least 10,000 distinct configs. Use the real route and request body required by the current session-init contract. Rotate test login sessions through normal authentication when necessary; a stale cookie is a workload error, never a reason to bypass authentication. The optional `cookie_file` contains the current Cookie header value and is read for every request. The fixture owner refreshes credentials through normal Auth and atomically replaces this private file. Relative paths resolve against the manifest directory. Optional `gateways` entries contain `cloud_origin`, `namespace_public_id`, `gateway_public_id`, and a private Gateway signing key (`private_key_b64u`) for separately measured signed Gateway status calls. Do not count those requests twice when real Gateway processes already generate them.

`samples.jsonl` records online count, distinct registered clients, observed disconnects, and cumulative operation histograms every second after ramp-up. Startup has a 300-second registration budget; the full requested steady-state duration starts only once every client is online. `steady_baseline` separates startup measurements from steady-state measurements. The production Gateway observer handles credential exhaustion and generation renewal. `report.json` records actual environment metadata, registration, heartbeat, pool maintenance, signed observation, and HTTP results without credentials or payloads. Latency buckets resolve one millisecond up to two seconds; the final bucket is overflow. The `steady/` histograms include only completions during the steady-state window. The steady scenario rejects observed disconnects, service error rates of at least 0.1%, and latency limits exceeded by heartbeat/query/issuance. The script requires the 500/50 HTTP workloads. Use `scenario: recovery` for separately timestamped fault exercises; its report remains pending incident evidence rather than inferring a healthy-service SLO during a deliberate outage. Collect independent CPU, RSS, Nginx admission, database wait, queue, and challenge-backlog samples on server hosts; client success alone cannot certify server resources.

Required runs use real Nginx/TLS, MySQL, and the published Flowersec SDK:

- 10,000 clients at the default 10-second policy for two hours; 5-second policy for an additional 30 minutes.
- One Runtime per Gateway and multiple Runtimes sharing each Gateway/Namespace.
- 500 environment queries/s and 50 session issuances/s throughout steady state.
- Region restart, temporary authority outage, concentrated reconnect, and admission overload. Record at least 99% recovery within 180 seconds, including exhausted credential pools and their real recovery path.
- Separate 30- and 60-second policy measurements, followed by reversal to 10 seconds. Changing the default cannot substitute for the default-period qualification.

Healthy dependencies require zero erroneous disconnects, heartbeat p95 ≤500ms and p99 ≤2s, query/init p95 ≤1s, service errors <0.1%, Region CPU <70%, total RSS <8 GiB, and no sustained connection, queue, or challenge-table growth. A complete qualification report attaches the exact paired Portal/Runtime versions, source and image digests, server measurements, incident/recovery timestamps, and representative real Runtime integration evidence. Missing infrastructure or measurements leave qualification pending.

## Control heartbeat policy

Registration and successful heartbeat responses carry one session-scoped `heartbeat_policy` with `revision`, `interval_ms`, and `offline_timeout_ms`. Runtime accepts intervals from 5,000 through 60,000 milliseconds, requires a positive revision, and requires the timeout to equal `max(90000, 3 * interval_ms + 30000)`. Older revisions cannot replace a newer policy; equal revisions with different content terminate the unusable session. The default Region policy is 10 seconds. A resettable timer schedules serialized heartbeats and applies the next successful response without restarting the control channel. A replacement session always obtains its initial policy from registration.

Gateway observation reuses HTTP transports for an exact identity, membership version, binding generation, certificate, trust root, and egress configuration. Replacing that identity cancels old calls and retires idle connections. Every request still obtains a fresh challenge and signature; observations never cache authority decisions. Startup registration and required observations run immediately, with randomized initial phases for subsequent periodic work. Capacity qualification is defined in `redeven:okf/operations/controlplane-capacity-qualification.md`.

# Boundaries

This opt-in qualification is separate from ordinary commit and push checks. A local unit or browser fixture does not establish capacity acceptance. Credentials remain only in restricted load-host state, while published reports contain counts, timings, and actual machine specifications.

# Evidence

- `redeven:internal/agent/controlplane_capacity_qualification_test.go` — Production control lifecycle and signed Gateway observation harness.
- `redeven:scripts/run_controlplane_capacity.sh` — Independent load-host invocation and fixture limits.
- `redeven:internal/agent/heartbeat_policy.go` — Session-scoped policy validation.
- `redeven:internal/agent/gateway_status_client.go` — Identity-fenced HTTP client reuse.
