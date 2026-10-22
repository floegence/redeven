---
type: Architecture Contract
title: Plugin process sessions
description: ReDevPlugin owns opaque external-process sessions, bounded binary streams, and cleanup; Redeven only supplies authenticated owner, secret, policy, audit, and diagnostic adapters.
tags: [architecture, plugins, processes, redevplugin]
timestamp: 2026-10-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
Every session binds plugin instance, user scope, environment scope, plugin invocation/session, and client key. Start requests contain an executable and argv array; ReDevPlugin never parses an implicit shell command string.

Secret references are resolved by the Host adapter and values do not cross the UI, error, audit, or diagnostic projections.

## Streams and lifecycle
The first contract supports non-PTY stdin, stdout, and stderr only. Each output stream has an independent cursor and bounded ring buffer.

The platform removes the session after close and prevents access after owner revocation.

# Boundaries

This concept owns platform process-session ownership, isolation, stream-loss semantics, and cleanup. Background entry lifecycle is defined by [Plugin background entries](plugin-background-entries.md); Redeven product projection and installation review remain in [Plugin platform integration](plugin-platform-integration.md).

# Evidence

- ReDevPlugin `pkg/process/supervisor.go`, `pkg/process/supervisor_unix.go`, and `pkg/process/supervisor_windows.go` own session, stream, and process-tree behavior.

- ReDevPlugin `pkg/host/runtime_io.go` enforces method-level Process Broker access and emits redacted process diagnostics.

- Redeven `internal/redevpluginintegration/process_adapter.go` supplies owner authorization, minimal base environment, and secret resolution.
