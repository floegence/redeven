---
type: Architecture Contract
title: Plugin process sessions
description: ReDevPlugin owns opaque external-process sessions, bounded binary streams, and cleanup; Redeven only supplies authenticated owner, secret, policy, audit, and diagnostic adapters.
tags: [architecture, plugins, processes, redevplugin]
timestamp: 2026-10-07T00:00:00Z
---
# Summary

ReDevPlugin Process Broker is the single platform owner for local processes
requested by plugins. Redeven supplies the authenticated user and environment
scope, permission decision, minimal environment, secret resolver, state root,
audit sink, and diagnostic sink; it does not expose a second process protocol.
The observable outcome is an opaque session handle and bounded binary stdin,
stdout, and stderr operations. The failure boundary is explicit: process
output may be lost after a bounded buffer overflows, and Host shutdown,
disable, uninstall, revocation, or owner teardown terminates owned processes.

# Contract

## Ownership and isolation

Every session binds plugin instance, user scope, environment scope, plugin
invocation/session, and client key. Plugin code receives no PID, file
descriptor, OS handle, Host path, complete Host environment, or credential.
Start requests contain an executable and argv array; ReDevPlugin never parses
an implicit shell command string. A plugin may explicitly select a shell as
the executable, but shell semantics remain inside that executable.

Redeven maps an authenticated session through `internal/redevpluginintegration`
and rejects unknown users or environments. Background entries use a distinct
validated background owner. Secret references are resolved by the Host adapter
and values do not cross the UI, error, audit, or diagnostic projections.

## Streams and lifecycle

The first contract supports non-PTY stdin, stdout, and stderr only. Each output
stream has an independent cursor and bounded ring buffer. Reads report EOF,
process exit, and `stream_gap`; the platform does not promise durable delivery,
exactly-once reads, or cross-Host replay. Plugin protocol state and recovery
information belong in Plugin Data/Storage.

Unix process groups and Windows Job Objects contain process trees. Graceful
termination is followed by forced cleanup when required. The platform removes
the session after close and prevents access after owner revocation.

# Boundaries

This concept owns platform process-session ownership, isolation, stream-loss
semantics, and cleanup. Background entry lifecycle is defined by [Plugin
background entries](plugin-background-entries.md); Redeven product projection
and installation review remain in [Plugin platform integration](plugin-platform-integration.md).

# Evidence

- ReDevPlugin `pkg/process/supervisor.go`, `pkg/process/supervisor_unix.go`, and `pkg/process/supervisor_windows.go` own session, stream, and process-tree behavior.
- ReDevPlugin `pkg/host/runtime_io.go` enforces method-level Process Broker access and emits redacted process diagnostics.
- Redeven `internal/redevpluginintegration/process_adapter.go` supplies owner authorization, minimal base environment, and secret resolution.
- ReDevPlugin `pkg/process/supervisor_test.go` covers binary streams, independent cursors, gaps, client-key reuse, environment filtering, owner isolation, and shutdown cleanup.
