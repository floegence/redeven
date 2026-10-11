---
type: AI Product Contract
title: Tessiven Runtime discovery and operations
description: Discover scoped Runtime paths and delegate explicit connection, business access, and native process operations to their existing owners.
tags: [tessiven, runtime, desktop, gateway, security]
timestamp: 2026-10-11T00:00:00Z
---
# Summary

The Runtime-owned Tessiven product service is the authority for UI and Flower
Runtime discovery and dispatch. It composes the existing Desktop connection
registry, authenticated Gateway catalogs, Runtime business resource executors,
and Desktop lifecycle coordinator. Discovery observes registered paths without
starting a process or acquiring a business session. A reference identifies one
path; it grants no permission. Lost source authority, changed path generations,
replaced identities, and revoked permissions stop dispatch. A lost mutation
response reports an unknown outcome and permits only observation of the original
operation until its result is known.

# Contract

## Official surface

- `tessiven.runtimes` / `GET /_redeven_proxy/api/tessiven/runtimes` returns
  independent source availability and exact target paths.
- `tessiven.runtime.inspect` / `POST .../runtimes/inspect` reads status,
  bounded public diagnostics, or the original Desktop operation.
- `tessiven.runtime.action` / `POST .../runtimes/actions` requests connection
  or one supported `start`, `stop`, `restart`, or `update` process operation.
- `tessiven.inspect/action` retain the canonical canvas version, bound instance,
  and resource identity checks for Managed Services and containers.

The built-in `redeven-tessiven` skill selects an observed exact path, requests
connection or authentication explicitly, inspects current identity and actions,
uses existing Floret approvals for effects, then observes the original owner.
It must not read credentials, guess bindings, construct internal routes, or
organize Shell/SSH workarounds. The released Floret host-tool and effect contracts
and Flowersec explicit transport path are consumed directly. No sibling module,
replacement SDK, or product lifecycle queue is introduced.

## Source authority and discovery

Desktop registers its Tessiven host through owner-authenticated private Runtime
control. Runtime creates an ephemeral source nonce for that exact connection.
Desktop main supplies it only for the owning Env App or native Tessiven window root frame on its exact
private bridge or for its native Flower request. Each Runtime has an independent
host registration. Fresh business acquisition retains attribution in memory;
restored authorization records contain no source. Web Service, CodeSpace, nested
frame, unrelated-origin and worker requests cannot declare a native source;

public headers, model arguments, durable thread authority, canvas fields,
Gateway access, and browser handoff cookies cannot establish a Desktop source.
A replaced or closed host invalidates the nonce. A resumed turn after Runtime
restart has no preserved device authority and must originate from a new admitted
Desktop request. Live Runtime policy clamps source and target rights again at
the dispatch boundary; an unreadable configuration fails closed.

A source-scoped Desktop inventory includes saved direct placements even when
unconnected or stopped. Runtime Presence remains the sole capability owner.
Registered Desktop Gateways use the original `require_ready` client and bounded
parallel catalog observations. An existing member session is authenticated only
when its normal Runtime access-status endpoint confirms it; a window or
last-seen timestamp is insufficient. Each target reports registration, online
observation, connection, authentication, identity, generation, observation time,
source, location, and supported actions separately.

The authenticated local Runtime owner can also read the default official local
Gateway host catalog on the Flower execution machine. The shared Gateway host
client reads its published service record and holds its private host credential;
it does not scan directories or inspect member databases. A host-only member
supports catalog status without Desktop but needs a registered trusted Desktop
Gateway path for business access. Cloud sessions cannot borrow host catalog
rights. Current-device and Flower-execution-machine observations remain distinct.
Failures are reported per source and do not masquerade as empty catalogs.

Matching signed Gateway/member identity can associate an official host reference
with a registered Desktop Gateway route. Direct, Gateway, and alias paths remain
explicit. Names and URLs never establish equivalence or select an alternate path.
Ambiguous references fail closed.

## Connection and business access

Explicit connect reuses saved configuration and existing connection leases.
The original native connection or recovery surface handles password, MFA,
authorization, and unavailable placements. Tessiven does not require an already
open Env App, auto-pair a Gateway, or ask Flower to handle authentication secrets.

Gateway service operations use the original member transport, certificate pin,
and Electron session Cookie owner to reach the fixed Runtime-local
`POST /_redeven_proxy/api/tessiven/business` endpoint. Its payload contains
verified Runtime identity and a typed local resource request only. It cannot
carry claimed permission flags, an arbitrary URL, another Runtime reference,
or a process-lifecycle action. Effective service rights are the intersection of
the source Flower rights and the normally authenticated target Runtime session.
Gateway member management rights never become Runtime business rights.

Immediately before dispatch, the selected registered Gateway, active member
version and identity, existing session/document generation, authentication, and
source signal are rechecked. Resource mutations additionally require the
observed path generation and current resource identity. The fixed target
executor rechecks live policy and the original resource manager. Member removal
and replacement retire the transport; no local or alternate route is substituted.

## Native lifecycle handoff

Process actions use saved direct Desktop placements and the existing
[Desktop lifecycle owner](../desktop/desktop-runtime-process-lifecycle.md).
Gateway paths provide no private process-control endpoint. The model cannot
choose a download URL or release version; the existing release selector owns
updates and post-operation verification.

Tessiven creates a pending confirmation in the original Launcher registry and
returns `handoff_required` with its operation key. That state describes a request,
not an admitted process operation. A native dialog names the exact action and
target and warns when the Runtime executes the current conversation. Opening
the dialog does not close a session, stop a process, or report success.

After acceptance, Desktop checks that the original request is still pending,
revalidates the private source against live Runtime policy, and checks target
configuration, generation, identity and capability. It rechecks source rights
before delegating to the original coordinator. The coordinator retains target
serialization, workload confirmation, cancellation, direct execution, and final
process/version verification. Cancel or changed authority before admission
leaves the Runtime untouched. Launcher owns progress and terminal result; only
bounded status/phase facts cross back to Flower.

The lifecycle request ID identifies the original Launcher operation, including
recovery after a lost handoff response. Reusing that ID never replays a lifecycle
effect. Operation observation can survive a process-generation change while
remaining bound to the same original subject. Unknown connection outcomes
require checking the selected connection in its native owner rather than retrying.

# Boundaries

## UI and compatibility

The Connected environments panel and Runtime node entry use this same service.
Search and keyed refresh retain selection, focus, scroll and visible targets
when one source fails. Only the active target's controls are disabled. Unknown
mutations block another effect; querying a definitive original operation result
allows a subsequent explicit request. Guidance and states are localized in all
shipped catalogs and use the standard Dialog body description and stable buttons.

Runtime compatibility epoch 50 admits the scoped host and fixed business
contracts. Older endpoints require an explicit Runtime update; there is no
hidden compatibility path. Gateway v5 application access, Tessiven DSL, and
persistent database lineages retain their current shapes.

# Evidence

- `internal/tessiven/runtimes.go` — Scoped directory, local host catalog and fixed local business executor.
- `internal/tessiven/broker_test.go` — Unattributed/device-generation denial, permission recheck and unknown effects.
- `internal/codeapp/appserver/tessiven_source_test.go` — Public-header rejection and post-confirmation source revocation.
- `internal/localui/tessiven_source_test.go` — Fresh private acquisition retains source only in memory.
- `desktop/src/main/desktopSessionTransport.test.ts` — Exact-origin and trusted-frame source injection with spoof removal.
- `internal/localui/tessiven_control.go` — Private source registration and lifecycle preflight.
- `internal/gatewayhost/client.go` — Shared official host catalog client with private credential ownership.
- `desktop/src/main/tessivenRuntimes.test.ts` — Exact path/identity fencing, access-only capability and ambiguity denial.
- `desktop/src/main/tessivenRuntimeHandoff.test.ts` — No effect before acceptance, cancellation and validation failure.
- `desktop/src/main/main.ts` — Original registry, Gateway transport, authentication and lifecycle adapters.
- `internal/envapp/ui_src/src/styles/tessiven-runtimes.browser.test.tsx` — Narrow locale layouts, keyboard, refresh continuity and original-operation recovery.
- `internal/ai/tessiven_runtime_integration_test.go` — Canonical provider discovery retains fresh private source metadata without exposing it.
- `internal/ai/system_skills/redeven-tessiven/SKILL.md` — Official discovery-to-result workflow.
- `internal/runtimeservice/compatibility_contract.json` — Reviewed epoch authority.
