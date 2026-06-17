---
type: Protocol Contract
title: RCPP v2 provider API
description: The provider protocol OpenAPI contract covers discovery, OAuth, environment catalog, runtime health, bootstrap, and launch data.
tags: [protocol, provider, openapi, desktop]
timestamp: 2026-06-17T00:00:00Z
---

Redeven's machine-readable provider integration contract is `spec/openapi/rcpp-v2.yaml`. It is the remaining maintained provider protocol specification after stale human protocol Markdown was removed.

# Mechanism

The OpenAPI contract defines provider discovery under `/.well-known/redeven-provider.json`, OAuth authorization and token endpoints, provider account status, environment catalog listing, runtime health query, bootstrap ticket exchange, local bootstrap registration, and environment launch data resolution. Desktop and runtime code consume the same concepts through provider origin, provider id, access point origin, environment public id, runtime health snapshots, bootstrap tickets, and launch data.

# Boundaries

Human protocol Markdown is not the source of truth. Provider-facing changes must update the OpenAPI contract and corresponding runtime/Desktop code together.

# Citations

[1] redeven:spec/openapi/rcpp-v2.yaml:3 - The OpenAPI title names the Redeven Control Plane Provider Protocol.
[2] redeven:spec/openapi/rcpp-v2.yaml:15 - Provider discovery lives at `/.well-known/redeven-provider.json`.
[3] redeven:spec/openapi/rcpp-v2.yaml:45 - OAuth authorization starts at `/oauth/authorize`.
[4] redeven:spec/openapi/rcpp-v2.yaml:59 - OAuth token exchange lives at `/oauth/token`.
[5] redeven:spec/openapi/rcpp-v2.yaml:85 - Provider account status is exposed under `/api/rcpp/v2/account/status`.
[6] redeven:spec/openapi/rcpp-v2.yaml:101 - Environment listing is exposed under `/api/rcpp/v2/environments`.
[7] redeven:spec/openapi/rcpp-v2.yaml:128 - Runtime health snapshots are queried through `/api/rcpp/v2/environments/runtime-health/query`.
[8] redeven:spec/openapi/rcpp-v2.yaml:170 - Runtime bootstrap exchanges use `/api/rcpp/v2/runtime/bootstrap/exchange`.
[9] redeven:spec/openapi/rcpp-v2.yaml:191 - Local bootstrap registration uses `/api/rcpp/v2/local/bootstrap/register`.
[10] redeven:spec/openapi/rcpp-v2.yaml:201 - Launch data is resolved through `/api/rcpp/v2/launch-data`.
