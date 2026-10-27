---
type: Gateway Contract
title: Gateway client access
description: Derive management from verified host access and enroll URL clients without administrator grants.
tags: [gateway, desktop, access, identity]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Gateway exposes two fixed paths: verified host administration and environment-only URL access. Clients cannot choose roles or persist management authority. Runtime lifecycle and application authentication remain independent; Cloud operations still require Cloud authorization.

# Contract

## Host administration
Local, SSH, local-container and SSH-container connections acquire management only after actually reaching the target Gateway and verifying its private host credential. It never exposes the credential to Renderer, URL connections, Runtime channels or logs.

Removing a Desktop connection does not stop or delete the Gateway service.

## URL enrollment and reconnection
Administrators create client access codes through POST `/gateway/v6/clients/access-codes` or `redeven-gateway clients access-code`. An identical completion retry returns the original result after response loss; other clients cannot consume that code.

A client access code neither enrolls a Runtime nor grants Gateway administration.

## Client visibility and revocation
Host administrators list clients through POST `/gateway/v6/clients/list` or `redeven-gateway clients list`. The display name is a recognition label, never identity evidence.

Revocation survives restart.

## State and compatibility
Trust schema 3 retains Gateway and client keys, preserves previously allowed environment access and removes legacy management grants. A handshake mismatch requests a Gateway/Desktop update, not identity replacement or state reinstallation.

# Boundaries

Verified host access owns Gateway administration. URL enrollment grants only environment access; neither path replaces Runtime consent or Cloud authorization.

# Evidence

- `redeven:internal/runtimegateway/trust/access_code_lifecycle_test.go` — Expiry, atomic consumption, response-loss retry, persistence and migration.
