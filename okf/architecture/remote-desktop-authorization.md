---
type: Runtime Contract
title: Persistent remote desktop sharing approval
description: Restore approved desktop sharing without conflating saved OS authorization, active sessions, or Runtime startup.
tags: [desktop, runtime, authorization, wayland]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns the host's sharing preference and authenticated reset operation;
published `floe-native-apps` v0.22.24 owns OS authorization and private recovery
credentials. With the Runtime running in a logged-in graphical desktop, sharing
defaults to preserving first approval. Later connections attempt recovery before
requesting consent again. A saved credential is a recovery opportunity, not proof
that the OS will accept it. No credential reaches the viewer, URL or audit.
Uncertain single-use credentials are retained but never replayed indefinitely.
This contract governs the optional current-user Portal chain. Linux Desktop SSH
uses the [system-service deployment contract](remote-desktop-ssh-deployment.md);
Portal approval is never its installation or lock-screen prerequisite.

# Contract

## Policy and migration
`remote_desktop.unattended` remains the compatible preference field.

Session creation and viewer connection always use the saved host preference; renderer input cannot override it.

Audit contains the action and outcome, never credential contents.

## State and platform ownership
Desktop readiness (`ready`, `locked`, `session_unavailable`) is independent of authorization.

- `unsupported`: automatic Portal restoration is unavailable; temporary sharing remains possible. - `needs_consent`: no usable saved recovery credential exists. - `saved`: a credential can be attempted on the next connection. - `restoring`: a request using saved approval is pending. - `revoked`: the system has positively established revocation. - `unknown`: a previous attempt is uncertain; a fresh request is allowed.

This feature does not start the Runtime, install services, elevate privileges, bypass lock screens or provide login access.

## Single-use Portal transaction
The upstream private directory and grant/lock files validate current-user ownership, restrictive modes, regular files, schema and bounded content.

This is an unavoidable distinction between pre-submission failure and an uncertain request outcome.

SSH physical-desktop status and creation explicitly select the installed service. They never fall back to a Portal request when service preparation or authentication fails. This does not change local current-user Portal sharing or macOS system permission flows.

# Boundaries

Session closure, removed displays and invalid media revoke live input, clipboard, audio and painted authority under the [desktop session contract](remote-desktop.md). Old connections and generations cannot transfer authority to it.

# Evidence

- `internal/config/config.go` and `internal/config/remote_desktop_test.go`: effective migration and explicit opt-out.

- `internal/codeapp/appserver/remote_desktop.go` and `internal/codeapp/appserver/remote_desktop_test.go`: settings persistence, policy response and full permission.

- `internal/remotedesktop/authorization.go` and `internal/remotedesktop/authorization_test.go`: private native reset, cancellation and viewer exclusion.
