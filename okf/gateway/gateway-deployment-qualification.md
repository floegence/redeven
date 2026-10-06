---
type: Validation Guide
title: Gateway deployment qualification
description: Qualify outbound membership, isolated TLS applications and Cloud access under real network restrictions.
tags: [gateway, desktop, validation, networking, security]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

Qualification must prove Runtime-to-Gateway connection direction and real application behavior. Unit tests alone do not establish Electron certificate handling, browser MFA, MySQL migration or an isolated network path. Record each command's actual result; source changes or installer builds are not proof that an application flow passed. These affected-feature checks are separate from release packaging and the aggregate push gate.

# Contract

## LAN application acceptance

`scripts/check_gateway_access_browser.sh` starts production Gateway handlers and Runtime application handlers without Runtime TCP listeners or Cloud. It requires a real `code-server` executable on `PATH` or in `REDEVEN_CODE_SERVER_BIN`. It runs actual Electron with the production Node member transport and certificate partition implementation. It verifies pairing, automatic membership directory, login, MFA, secure cookies, session isolation, file and terminal RPC, Flower streaming, Web Service forwarding, native CodeSpace file editing and saving, management denial, wrong-certificate rejection and removal isolation.

`desktop/src/main/gatewayMemberTransport.test.ts` with `REDEVEN_GATEWAY_INTEROP=1` exercises the released Go/Node SDKs, stream cancellation, certificate rotation, exact destination confinement and member removal. Every test owns its temporary state and process tree. No global TLS exception, dependency overlay or system trust installation is permitted.

## Network and Cloud acceptance

`scripts/check_gateway_cloud_isolation.sh` provides a Docker network in which Runtime cannot reach Cloud IPs, public IPs or public DNS. Only the Gateway member endpoint is reachable. Runtime must still join, prove itself, recover and exchange protected traffic. Explicit network-denial probes must precede a passing claim.

Portal's task-owned compose Gateway smoke tests cover Namespace publication, environment opening, migration, custom Tunnel, password and MFA with real MySQL and browser sessions. Directory freshness, policy fencing and both closure receipts require independent assertions. A control-only outage must not be mistaken for data-session closure. Automatic publication and manual unpublication must preserve their different approval semantics.

## Product and release boundaries

Desktop renderer qualification checks all ten locales, narrow viewports, large text, keyboard activation, cancel focus, failed refresh and partial batches. Managed Gateway host tests use the production local/SSH/container lifecycle adapter; they do not restore Runtime lifecycle authority to Gateway.

Installer artifact signatures, upgrades and cross-platform packaging remain release-workflow responsibilities. A local source fixture cannot certify those results. Do not delete another task's processes, volumes, branches or worktrees while preparing or cleaning acceptance resources.

# Evidence

- `redeven:internal/localui/gateway_member_browser_test.go` — No-inbound-TCP production application fixture.
- `redeven:desktop/scripts/fixtures/gateway-access-electron.ts` — Real Electron member access assertions.
- `redeven:desktop/scripts/fixtures/gateway-runtime-browser.ts` — Real Flowersec business RPC and streaming.
- `redeven:internal/gatewaycloud/product_isolation_test.go` — Isolated Runtime and Cloud fixture.
- `redeven:scripts/check_gateway_cloud_isolation.sh` — Container network restriction harness.
- `redeven:desktop/src/main/gatewayMemberTransport.test.ts` — Published cross-language stream interoperability.
