---
type: Gateway Contract
title: Gateway service
description: Standalone optional Gateway identity, catalog, session, and access forwarding service.
tags: [gateway, desktop, release, access]
timestamp: 2026-08-24T00:00:00Z
---
# Summary

`redeven-gateway` is an optional standalone access forwarder. It owns Gateway identity, pairing, trust, Environment profiles, catalog responses, open-session artifacts, and request forwarding. It never owns, starts, stops, updates, reinstalls, or observes Runtime lifecycle state. Gateway failure can interrupt access through that Gateway, but it cannot block Desktop from managing a Runtime through an authorized Local, SSH, or container channel.

# Contract

## Standalone service

The Gateway CLI starts only the Gateway server. Its `service-start`, `service-status`, and `service-stop` commands manage the Gateway process and state root; they accept no Runtime root, Runtime artifact, activation, binding, or enrollment input. Gateway startup does not create, inspect, or start a Runtime.

The service persists only access-plane state: Gateway identity, paired clients, trust bindings, Environment profiles, catalog metadata, and session material. Runtime operations, target locks, checkpoints, quarantine, artifact staging, rollback, supervisor heartbeat, and Provider management transport are not Gateway state.

Gateway access remains useful without Desktop lifecycle management. An explicit Gateway profile can publish a catalog and issue an open-session artifact for a configured access endpoint. HTTP, WebSocket, and streaming traffic is forwarded according to that access contract; the Gateway does not translate access requests into process commands.

## Packaging

Gateway is built and published as the independent `redeven-gateway_<os>_<arch>.tar.gz` archive. The Desktop Runtime bundle and Runtime archive must not contain `redeven-gateway`, and normal Local, SSH, or container Runtime installation must not create a Gateway managed directory. Desktop may install or update a standalone Gateway only through an explicit Gateway workflow, with its binary stored under the Gateway state root rather than a Runtime root.

## Retired state

Removing Runtime lifecycle authority must not delete pairing, trust, profiles, catalog configuration, or access sessions. Retired lifecycle stores and staging directories have no production reader and are not consulted before serving access or before a Desktop direct Runtime operation. Cleanup is limited to known Gateway-owned lifecycle artifacts and never reaches a Runtime root or user workspace.

# Boundaries

Desktop owns Runtime lifecycle only for targets with an authorized direct management channel. Provider owns discovery and access authorization. Runtime owns business execution. Gateway owns only its process and the access plane described above. A Gateway-only Environment is access-only and exposes no Runtime lifecycle action.

# Evidence

- `redeven:cmd/redeven-gateway/main.go:1` - Standalone Gateway CLI and Gateway-only service commands.
- `redeven:internal/gatewayservice/server.go:1` - Pairing, catalog, profile, open-session, and access forwarding routes.
- `redeven:internal/gatewayservice/server_test.go:1` - Verifies Runtime lifecycle routes and state are absent.
- `redeven:spec/openapi/gateway-v2.yaml:1` - Access-only Gateway HTTP contract.
- `redeven:desktop/src/main/gatewayServiceHost.ts:1` - Explicit standalone Gateway installation under the Gateway state root.
- `redeven:.github/workflows/release.yml:1` - Independent Gateway archive build and publication.
