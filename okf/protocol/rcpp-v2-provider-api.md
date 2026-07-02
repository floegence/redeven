---
type: Protocol Contract
title: RCPP v2 provider API
description: The provider protocol OpenAPI contract covers discovery, Desktop authorization, environment catalog, runtime health, Desktop open-session, and runtime bootstrap.
tags: [protocol, provider, openapi, desktop]
timestamp: 2026-06-17T00:00:00Z
---

Redeven's machine-readable provider integration contract is `spec/openapi/rcpp-v2.yaml`. It is the remaining maintained provider protocol specification after stale human protocol Markdown was removed.

# Mechanism

The OpenAPI contract defines provider discovery under `/.well-known/redeven-provider.json`, Desktop authorization code creation, Desktop connect exchange, Desktop token refresh/revoke, provider account status, environment catalog listing, runtime health query, Desktop open-session material, and runtime bootstrap ticket exchange. Desktop and runtime code consume the same concepts through provider origin, provider id, access point origin, environment public id, runtime health snapshots, Desktop open-session material, bootstrap tickets, and direct runtime connection information.

# Boundaries

Human protocol Markdown is not the source of truth. Provider-facing changes must update the OpenAPI contract and corresponding runtime/Desktop code together.

RCPP providers are external control-plane and access-point authorities, not plugin capability providers. Provider IDs, access point IDs, environment public IDs, Desktop authorization tokens, bootstrap tickets, and direct connection fields must not be reused as plugin installation identities, plugin capability names, plugin broker grants, or plugin runtime leases. Plugins hosted inside Redeven should reach environment and business resources through Local UI session context, released ReDevPlugin brokers, and Redeven-registered adapters rather than by speaking RCPP provider endpoints directly.

# Citations

[1] redeven:spec/openapi/rcpp-v2.yaml:3 - The OpenAPI title names the Redeven Control Plane Provider Protocol.
[2] redeven:spec/openapi/rcpp-v2.yaml:15 - Provider discovery lives at `/.well-known/redeven-provider.json`.
[3] redeven:spec/openapi/rcpp-v2.yaml:26 - Desktop authorization code creation uses `/api/rcpp/v2/desktop/authorize`.
[4] redeven:spec/openapi/rcpp-v2.yaml:45 - Desktop connect exchange uses `/api/rcpp/v2/desktop/connect/exchange`.
[5] redeven:spec/openapi/rcpp-v2.yaml:64 - Desktop token refresh uses `/api/rcpp/v2/desktop/token/refresh`.
[6] redeven:spec/openapi/rcpp-v2.yaml:83 - Desktop token revoke uses `/api/rcpp/v2/desktop/token/revoke`.
[7] redeven:spec/openapi/rcpp-v2.yaml:98 - Provider account data is exposed under `/api/rcpp/v2/me`.
[8] redeven:spec/openapi/rcpp-v2.yaml:113 - Environment listing is exposed under `/api/rcpp/v2/environments`.
[9] redeven:spec/openapi/rcpp-v2.yaml:128 - Runtime health snapshots are queried through `/api/rcpp/v2/environments/runtime-health/query`.
[10] redeven:spec/openapi/rcpp-v2.yaml:149 - Desktop open-session material is created through `/api/rcpp/v2/environments/{envId}/desktop/open-session`.
[11] redeven:spec/openapi/rcpp-v2.yaml:170 - Runtime bootstrap exchanges use `/api/rcpp/v2/runtime/bootstrap/exchange`.
[12] redeven:okf/architecture/plugin-platform-integration.md:75 - RCPP provider credentials are adjacent host mechanisms, not plugin grant planes.
