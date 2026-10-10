---
type: Gateway Contract
title: Gateway network settings
description: Configure share endpoints, next-start listener bindings and request Host restrictions without changing member authority.
tags: [gateway, network, security, desktop, migration]
timestamp: 2026-10-09T00:00:00Z
---
# Summary

Gateway owns three independent network settings: administrator-confirmed Runtime share endpoints, local listener bindings, and optional request Host restrictions. A verified host administrator saves them atomically. Listener edits take effect on the next explicit start or restart; the current sockets remain active. Empty Host restrictions permit every request hostname while all existing TLS, invitation, member and Desktop authorization continues to apply. Invalid configuration or failed persistence leaves the previous durable and live configuration intact.

# Contract

## Configuration ownership

`POST /gateway/v5/network-settings` requires current verified host management proof and saves one bounded settings object. It accepts up to sixteen local IP:port or hostname:port bindings, sixty-four exact hostnames or IP addresses, and sixteen confirmed HTTPS share endpoints. Bindings and Host restrictions reject duplicates. Hostnames are case-insensitive; restrictions have no scheme, port or wildcard. Desktop validates the same shape at its IPC boundary.

A bind address names a socket on the Gateway device. A share endpoint names the address a Runtime should dial and may include DNS or port forwarding. Share endpoints alone provide ordinary TLS certificate names. Editing either setting preserves the stable Gateway key, member CA, membership, policy and Cloud associations. Removing all share endpoints disables new invitation issuance; listener sockets remain independently configured.

The catalog distinguishes configured bindings, currently active socket addresses and restart-required status. Saving bindings never starts, stops or restarts Gateway. Normal explicit lifecycle actions apply the stored bindings on startup. A runtime-selected ephemeral port is reported as an active address rather than replacing the configured `:0` binding.

# Boundaries

## Request Host restriction

The default empty list accepts all request Host names. A populated list matches the original HTTP authority's hostname or IP exactly, ignoring its port and normalizing case. Forwarded headers cannot expand the list. The check applies before product member HTTP routing, including invitation exchange, and before released Flowersec direct/tunnel upgrades.

Cloud HTTP CONNECT authority describes the outbound destination, so it remains governed by the existing Cloud egress admission policy rather than the Gateway request Host list. Host restrictions do not grant application access, authorize Runtime management or replace client authentication. The separate native host administration listener retains its request-bound host proof and browser Origin rejection.

## Durable upgrade and recovery

Member state v4 appends `allowed_hosts` to the existing endpoint state. The contiguous v3-to-v4 migration initializes an unrestricted list, preserves all existing member, invitation, endpoint, identity and policy data, and retains the supported earlier migration edges. Future versions and invalid network shapes fail read-only. Atomic state replacement owns the save boundary; a write failure cannot install partial network settings in memory.

# Evidence

- `redeven:internal/gatewaymembership/network.go` — Validation, atomic persistence and original Host matching.
- `redeven:internal/gatewaymembership/network_test.go` — Migration, preserved member authority, future rejection and failed-write rollback.
- `redeven:internal/gatewaymembership/listener.go` — Product routing and published Flowersec upgrade admission.
- `redeven:internal/gatewayservice/network_test.go` — Real TLS sockets, host-proof enforcement and saved-binding restart.
- `redeven:desktop/scripts/check-gateway-network-host.mjs` — Real Desktop host bridge save, retained listener and explicit restart.
- `redeven:desktop/src/shared/gatewayNetworkSettings.ts` — Bounded IPC validation.
- `redeven:spec/openapi/gateway-v5.yaml` — Executable network settings and catalog contract.
