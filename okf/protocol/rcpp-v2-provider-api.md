---
type: Protocol Contract
title: RCPP v3 provider API
description: Provider discovery, health, open-session, Runtime link, and access authorization contract.
tags: [protocol, provider, openapi, desktop, runtime, access]
timestamp: 2026-08-24T00:00:00Z
---
# Summary

RCPP v3 lets Desktop discover Provider Environments, read access health, open an authorized session, and link a Runtime for Provider access. Provider is not a Runtime lifecycle owner: its Environment response carries no Runtime management capability, and it issues no Start, Stop, Restart, Update, Reinstall, enrollment, supervisor, or artifact authority. A removed lifecycle request fails as unsupported or not found without a compatibility fallback.

# Contract

## Discovery and access

Provider exposes discovery, Environment list, health, Desktop open-session, Runtime link authorization/exchange, and the authorization needed to forward normal requests. Open-session is access-only and never carries a process-management instruction. Runtime link establishes the scoped Provider-to-Runtime access relationship; it does not enroll a lifecycle supervisor.

Environment list responses describe identity, availability, health, and access routes. They do not contain `runtime_management`, lifecycle permissions, permits, target generations, bindings, relay state, supervisor freshness, or operation projections. Health is an access observation and cannot make Provider a lifecycle coordinator.

## Authorization boundary

Provider authenticates the user and grants access to an Environment or Runtime link. It never receives Desktop SSH credentials, container credentials, a Runtime installation root, or a Runtime package. It cannot turn a Gateway access endpoint into a management channel.

Desktop may show Provider Connect or Disconnect for a directly managed Runtime target. That action links access identity only. All Runtime lifecycle actions continue through the target's Local, SSH, or container channel and remain available independently of Provider health.

The retired Runtime management routes, permits, enrollment challenge/exchange, supervisor heartbeat, poll/respond transport, bindings, relays, cluster state, and authorization audit have no supported schema or compatibility shell. Because those contracts were not deployed, their migrations are removed rather than retained as dead production paths.

# Boundaries

RCPP v3 does not mirror Desktop Launcher Operations or Gateway state. Provider may route requests to Runtime directly or through an optional Gateway, but it cannot start or repair the destination. An Environment with Provider or Gateway access but no direct Desktop management channel remains access-only.

# Evidence

- `redeven:desktop/src/main/controlPlaneProviderClient.ts:1` - Desktop Provider discovery, health, open-session, and Runtime-link adapter.
- `redeven:desktop/src/shared/controlPlaneProvider.ts:1` - Access-only Provider DTOs exposed to Desktop.
- `redeven:desktop/src/shared/environmentManagementPrinciples.ts:1` - Separates Provider cards from direct Runtime operation targets.
- `spec/openapi/gateway-v2.yaml:1` - Gateway access-only protocol surface.
