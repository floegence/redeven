---
type: Gateway Contract
title: Gateway service
description: Manage Runtime-initiated membership without acquiring Runtime lifecycle authority.
tags: [gateway, desktop, access, identity]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`redeven-gateway` owns one durable member directory, one-time invitation-code consumption, client access grants, policy and restricted forwarding. Runtime verifies the Gateway address and code, previews the signed enrollment descriptor, then explicitly confirms membership. Gateway never dials a Runtime address, scans a network, or installs, starts, stops, updates or resets a Runtime. LAN access works without Cloud. Gateway loss interrupts its network paths; independently authorized Runtime management remains separate.

# Contract

## Membership authority
An administrator verified through the Gateway host creates a ten-minute, single-use invitation code and shares an administrator-confirmed Gateway address. Gateway never obtains Runtime Cloud credentials from its directory.

Desktop display association uses the trusted Runtime management membership summary and the paired Gateway key; public health proof remains a separate observation and grants no authority.

## Policy and executable hooks
New installations deny Cloud by default.

Programs use an absolute executable and argument array, never a shell. Desktop member management and `redeven-gateway members reevaluate --member ID --version N` check the current member version before applying the same reevaluation.

## Own-process management
The separate Gateway archive and state root contain no Runtime lifecycle data. Saving, refresh, pairing or member management never starts a stopped service implicitly.

Cancellation still stops development startup and exact owned-process cleanup remains required.

## Address changes and upgrade
[Gateway network settings](gateway-network-settings.md) owns atomic network configuration, next-start listener changes, request Host admission and its persistent migration boundary.

If all fail, the membership stays intact and reports Gateway unavailable.

Optional Cloud publishing remains a separate flow.

# Boundaries

Gateway owns membership, policy, invitations, and restricted forwarding. Gateway never dials arbitrary Runtime addresses or turns observations into authority.

# Evidence

- `redeven:internal/config/cloud_config_version_test.go` - Unsupported configuration fails without rewriting operator state.

- `redeven:internal/agent/cloud_route_test.go` - Route changes preserve Cloud association and fence stale owners.

- `redeven:internal/gatewaymembership/store.go` — Sole durable membership and invitation delivery.
