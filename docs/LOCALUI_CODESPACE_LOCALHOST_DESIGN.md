# Local UI Codespace Access (localhost-first, no custom hostnames)

## Background

- Current Local UI behavior opens a codespace window at `http://127.0.0.1:<code_port>/`.
- A previous attempt routed Local UI through `cs-<code_space_id>.localhost:<port>` to force gateway-origin semantics and strip code-server PWA Service Worker headers.
- That attempt was reverted because the URL pattern is surprising in local mode and hurts user trust, even though `*.localhost` usually resolves to loopback without editing `/etc/hosts`.

## Problem Statement

In Local UI mode, we need both:

1. **Simple UX**: user-facing URL should look like normal localhost access.
2. **Stable behavior**: avoid code-server PWA Service Worker taking broad scope and interfering with runtime/proxy behavior.

Key constraints from current codebase:

- Local open path is hardcoded to `127.0.0.1:<code_port>` in `internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx`.
- Gateway codespace routing currently keys by host label `cs-<id>` in `internal/codeapp/gateway/gateway.go`.
- `code-server 4.108.2` does not expose an official CLI flag to disable its PWA Service Worker registration.

## Goals

- Keep Local UI codespace URL as plain localhost (`127.0.0.1:<port>`).
- Do not require host file edits or special DNS setup.
- Keep an interception point to sanitize code-server Service Worker scope behavior.
- Minimize impact on standard (non-local) env/cs/pf origin model.

## Non-Goals

- Do not redesign standard remote origin isolation (`env-`/`cs-`/`pf-`).
- Do not solve every extension-host reconnect cause in this change.
- Do not introduce compatibility layers for legacy APIs unless required.

## Chosen Approach

Use a **localhost entry proxy per codespace** in Local UI mode.

### High-level flow

1. `StartSpace` ensures code-server is running on an internal backend port (existing behavior).
2. In Local UI mode, agent also ensures a per-codespace **entry proxy port** on loopback.
3. Env App opens `http://127.0.0.1:<entry_port>/?folder=...` (still localhost UX).
4. Entry proxy reverse-proxies to backend code-server port and applies response/request hardening.

### Why this over `cs-*.localhost`

- Preserves intuitive localhost UX.
- Removes hostname semantics from Local UI user path.
- Keeps a controlled proxy layer (needed to sanitize SW-related headers and future hardening).

## Detailed Design

### 1) Local-only entry proxy manager

Add a manager that tracks mapping:

- `code_space_id -> {entry_port, backend_port, proxy_server}`

Lifecycle:

- `StartSpace`: ensure mapping exists and server is listening.
- `StopSpace/DeleteSpace/Service.Close`: stop and cleanup proxy server.
- Reconcile on restart: lazy re-create when `StartSpace` is called.

### 2) Response hardening at proxy layer

For responses whose path matches code-server PWA SW script (`.../out/browser/serviceWorker.js`):

- Remove `Service-Worker-Allowed` header.

Result:

- code-server cannot expand SW scope to `/` via that header.
- webview-pre service worker path remains available (no blanket SW blocking).

### 3) Request forwarding policy

Proxy should:

- Forward to `http://127.0.0.1:<backend_port>`.
- Keep `Host`/`Origin` aligned with entry origin (`127.0.0.1:<entry_port>`).
- Drop `Forwarded` and `X-Forwarded-*` headers to avoid upstream host confusion.

### 4) API contract in Local UI mode

Keep current UI contract simple:

- `SpaceStatus.code_port` returned by `StartSpace` and `ListSpaces` should represent **browser access port**.

In Local UI mode:

- `code_port = entry_port` (user-facing proxy port).

In standard mode:

- existing behavior remains unchanged.

## Module-level Change Plan

- `internal/codeapp/`
  - introduce local entry proxy manager package/file(s)
  - wire manager into service lifecycle
  - adjust `StartSpace`/`ListSpaces` port value in Local UI mode
- `internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx`
  - keep existing localhost URL construction (no domain-host logic)
  - consume returned `code_port` as access port
- `internal/codeapp/gateway/`
  - no new Local UI hostname routing changes required for this plan

## Risk Analysis

- **Port exhaustion/conflict**: manage via existing configurable code-server range or a dedicated entry range; fail fast with actionable error.
- **Stale proxies after crash**: recreate lazily on `StartSpace`; ensure cleanup on normal shutdown.
- **Behavior drift between local and standard mode**: gate logic behind `LocalUIAllowedOrigins` presence.
- **Pending UX not fully fixed**: extension-host reconnects may still need follow-up diagnostics; this plan removes a known SW risk and restores URL UX.

## Validation Strategy

Functional checks:

- Local open URL is `http://127.0.0.1:<port>/...` (no `cs-*` hostname).
- `navigator.serviceWorker.controller.scriptURL` is not code-server PWA SW on new sessions.
- `navigator.serviceWorker.getRegistrations()` does not retain broad-scope code-server PWA SW after load stabilization.
- create-file flow no longer shows prolonged "File Create participants..." pending under normal conditions.

Engineering checks:

- Add/adjust unit tests for proxy header rewriting and Local UI start/list port behavior.
- Run `go test ./...` and `golangci-lint run ./...` in `redeven-agent` before merge.

## Rollback Plan

If regressions appear:

1. Keep Local UI URL on localhost.
2. Disable entry proxy manager behind a temporary feature toggle in code.
3. Fall back to direct code-server port open while preserving diagnostic logs for SW and reconnect events.

