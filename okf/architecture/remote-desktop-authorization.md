---
type: Runtime Contract
title: Persistent remote desktop sharing approval
tags: [desktop, runtime, authorization, wayland]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven owns sharing preference/reset; Floe Native Apps owns OS consent/private recovery. Logged-in Runtime may reuse saved approval, which proves no admission and never reaches viewers/URLs/audits. This user Portal path is separate from SSH system-service deployment.

# Contract

- Compatible preference `remote_desktop.unattended` controls both creation and connection; renderer cannot override it. Audit only action/outcome.
- Readiness (`ready`, `locked`, `session_unavailable`) is independent of authorization: `unsupported` allows temporary sharing; `needs_consent` has no usable credential; `saved` permits an attempt; `restoring` is pending; `revoked` requires positive OS evidence; `unknown` allows a fresh request after uncertainty.
- Upstream validates credential-directory/file owner, restrictive modes, regular-file type, schema and bounded content. Retain uncertain single-use credentials without indefinite replay.
- SSH status/creation select installed service and never fall back to Portal after preparation/authentication failure. Local Portal/macOS permission flows remain separate.

# Boundaries

Approval reuse does not start Runtime, install/elevate, bypass lock screens or grant login. [Session ownership](remote-desktop.md) revokes input, clipboard, audio and painted authority on closure/invalid media; old generations cannot transfer it.

# Evidence

- `internal/config/config.go` and `internal/config/remote_desktop_test.go`: effective migration and explicit opt-out.

- `internal/codeapp/appserver/remote_desktop.go` and `internal/codeapp/appserver/remote_desktop_test.go`: settings persistence, policy response and full permission.

- `internal/remotedesktop/authorization.go` and `internal/remotedesktop/authorization_test.go`: private native reset, cancellation and viewer exclusion.
