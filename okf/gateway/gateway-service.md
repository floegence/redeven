---
type: Gateway Contract
title: Gateway service
tags: [gateway, desktop, access, identity]
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

redeven-gateway owns durable membership, one-time invitations, client grants, policy and restricted forwarding. Runtime verifies address/code, previews signed enrollment then explicitly joins. Gateway never scans/dials Runtime addresses or manages Runtime lifecycle. LAN needs no Cloud; Gateway loss affects its paths, not independent management authority.

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

## Compatibility and updates

Gateway release tags and source commits are diagnostics, not admission gates. Desktop validates the installed binary against its own installation stamp, then observes service readiness and the actual Gateway wire/authority contract. An unrelated Desktop or Runtime release never forces Gateway replacement. Start/restart reuse an intact installed package; explicit Update validates the staged archive against the selected release and commit before activation. Package corruption, stopped service, pairing failure and protocol incompatibility remain distinct diagnoses; authorization rejection never implies an outdated build.

Gateway v6 owns its authority epoch independently of Runtime Service. The existing value 69 is preserved so deployed services remain compatible; change it only for a reviewed Gateway authority break. Runtime metadata versions do not gate membership. Preserve signed identity, consent, permissions, freshness and current protocol validation; best-effort compatibility does not accept unknown security contracts. A feature failure affects that operation, not unrelated members or Runtime lifecycle authority.

## Address changes and upgrade
[Gateway network settings](gateway-network-settings.md) owns atomic network configuration, next-start listener changes, request Host admission and its persistent migration boundary.

If all fail, the membership stays intact and reports Gateway unavailable.

Optional Cloud publishing remains a separate flow.

# Boundaries

Gateway owns membership, policy, invitations, and restricted forwarding. Gateway never dials arbitrary Runtime addresses or turns observations into authority.

# Evidence

- `redeven:desktop/src/main/gatewayServiceHost.test.ts` — Different release/commit reuse and independent package integrity.

- `redeven:internal/config/cloud_config_version_test.go` - Unsupported configuration fails without rewriting operator state.

- `redeven:internal/gatewaymembership/store.go` — Sole durable membership and invitation delivery.
