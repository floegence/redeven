---
type: Gateway Contract
title: Gateway network settings
tags: [gateway, network, security, desktop, migration]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Verified host admin atomically saves share endpoints/listeners/Host restrictions. Listener changes require explicit restart; live sockets persist. Empty hostname restrictions never weaken TLS/invitations/membership/Desktop policy. Invalid or failed writes preserve saved/live state.

# Contract

## Configuration ownership
`POST /gateway/v6/network-settings` requires current verified host management proof and saves one bounded settings object.

Desktop Settings shows the saved listener bindings separately from active addresses. A pending restart exposes an explicit review action using the same Gateway lifecycle confirmation and progress as card maintenance. Saving never restarts the service.

A runtime-selected ephemeral port is reported as an active address rather than replacing the configured `:0` binding.

When the service cannot start, verified host maintenance can pass explicit bind addresses through a confirmed reinstall. The IPC and host owner validate one to sixteen unique bindings before mutation; the lifecycle fingerprint includes the bindings. No address is chosen after an error. Rebuild confirmation reviews bindings separately from the destructive reset. Ordinary reinstall can correct an occupied port while preserving configuration and the existing recovery archive. Listener-only host changes preserve TLS authority and do not require or publish share endpoints; fresh configuration accepts multiple bindings.

# Boundaries

## Request Host restriction
The default empty list accepts all request Host names. Forwarded headers cannot expand the list.

The private Unix host administration socket requires its host credential and rejects browser Origin. The unified public TLS listener mounts no management route.

## Durable upgrade and recovery
Attachment state schema 6 owns allowed_hosts, endpoints and local egress policy. Other versions and invalid network shapes fail read-only. Atomic state replacement owns the save boundary; a write failure cannot install partial network settings in memory.

# Evidence

- `redeven:internal/gatewaymembership/network.go`
- `redeven:internal/gatewaymembership/network_test.go` — Migration, preserved member authority, future rejection and failed-write rollback.
