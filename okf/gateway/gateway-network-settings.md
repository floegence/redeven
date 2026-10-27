---
type: Gateway Contract
title: Gateway network settings
description: Configure share endpoints, next-start listener bindings and request Host restrictions without changing member authority.
tags: [gateway, network, security, desktop, migration]
timestamp: 2026-10-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Gateway independently owns admin-confirmed share endpoints, listeners and optional Host restrictions, saved atomically by verified host admin. Listener edits require explicit restart; live sockets persist. Empty restrictions allow hostnames without weakening TLS/invitation/member/Desktop authorization. Invalid input or failed writes preserve saved/live state.

# Contract

## Configuration ownership
`POST /gateway/v6/network-settings` requires current verified host management proof and saves one bounded settings object.

Desktop Settings shows the saved listener bindings separately from active addresses. A pending restart exposes an explicit review action using the same Gateway lifecycle confirmation and progress as card maintenance. Saving never restarts the service.

A runtime-selected ephemeral port is reported as an active address rather than replacing the configured `:0` binding.

# Boundaries

## Request Host restriction
The default empty list accepts all request Host names. Forwarded headers cannot expand the list.

The separate native host administration listener retains its request-bound host proof and browser Origin rejection.

## Durable upgrade and recovery
Member state v4 appends `allowed_hosts` to the existing endpoint state. Future versions and invalid network shapes fail read-only. Atomic state replacement owns the save boundary; a write failure cannot install partial network settings in memory.

# Evidence

- `redeven:internal/gatewaymembership/network.go` — Validation, atomic persistence and original Host matching.

- `redeven:internal/gatewaymembership/network_test.go` — Migration, preserved member authority, future rejection and failed-write rollback.
