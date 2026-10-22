---
type: Desktop Contract
title: Desktop runtime bridge
description: Canonical navigation and security boundary for Desktop-integrated Runtime access and direct lifecycle.
tags: [desktop, runtime, bridge, lifecycle]
timestamp: 2026-08-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven Desktop opens Runtime instances through machine-readable startup, scoped transport, session, and process contracts. Runtime remains independently runnable without Gateway. Redeven-managed lifecycle actions use the registered Local, WSL, SSH, or container direct channel and are owned by Desktop's process-local coordinator; Gateway and Provider remain access-only. This overview is the canonical navigation point for readiness, recovery, WSL/SSH operations, and model/session integration. Focused concepts own the independent details while this concept retains the boundary between Desktop lifecycle coordination, Runtime services, optional access forwarding, and plugin capabilities.

# Contract

## Mechanism
This concept is the stable overview for the subject.

Settings, model directory, preferences, and thread-detail GETs can carry it; commands, request bodies, and staging authorization cannot.

A worker cannot borrow another partition's bridge or attach its token to a public origin.

# Boundaries

Runtime-control is a local Desktop coordination capability, not a general network API or plugin grant plane. Bridge, health, process, Gateway, Provider, and session observations must not become competing lifecycle authorities. ReDevPlugin and access components retain their separate execution boundaries.

# Evidence

- `redeven:desktop/src/main/desktopCertificate.test.ts` - Exercises explicit setup, preserved identity after trust failure, verification, and HTTPS restart admission.

- `redeven:desktop/src/welcome/LocalCertificateSettings.client.test.tsx` - Covers legacy trust status, actionable retries, duplicate actions, and stale environment responses.

- `redeven:cmd/redeven/main.go:299` - Local Desktop startup is rejected for remote-only mode.
