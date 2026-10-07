---
type: Runtime Contract
title: Persistent remote desktop sharing approval
description: Restore approved desktop sharing without conflating saved OS authorization, active sessions, or Runtime startup.
tags: [desktop, runtime, authorization, wayland]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Redeven owns the host's sharing preference and authenticated reset operation;
published `floe-native-apps` v0.22.19 owns OS authorization and private recovery
credentials. With the Runtime running in a logged-in graphical desktop, sharing
defaults to preserving first approval. Later connections attempt recovery before
requesting consent again. A saved credential is a recovery opportunity, not proof
that the OS will accept it. No credential reaches the viewer, URL or audit.
Uncertain single-use credentials are retained but never replayed indefinitely.

# Contract

## Policy and migration

`remote_desktop.unattended` remains the compatible preference field.
`approval_preference_set` records a choice made through the current settings API.
Missing configuration, missing fields and legacy false values use persistence;
only an explicit new false choice selects confirmation on each connection.
Existing true values remain persistent. Migration changes the effective policy
without granting permission, modifying system settings or deleting credentials.

The status and settings APIs return `unattended` and the effective
`approval_policy` (`persistent` or `session`). A settings mutation requires an
explicit boolean. Session creation and viewer connection always use the saved
host preference; renderer input cannot override it. Changing the preference
updates existing product sessions; disabling reuse retires their attachments.

`DELETE /_redeven_proxy/api/remote-desktop/authorization` requires full environment
permission and asks the upstream helper to forget its local grant. It does not
revoke GNOME permission or close active sharing. The native start lease serializes
reset against a pending authorization request, returning a busy conflict rather
than racing token rotation. The viewer command channel cannot issue this operation.
Audit contains the action and outcome, never credential contents.

## State and platform ownership

Desktop readiness (`ready`, `locked`, `session_unavailable`) is independent of
authorization. The upstream authorization enum has these meanings:

- `unsupported`: automatic Portal restoration is unavailable; temporary sharing remains possible.
- `needs_consent`: no usable saved recovery credential exists.
- `saved`: a credential can be attempted on the next connection.
- `restoring`: a request using saved approval is pending.
- `revoked`: the system has positively established revocation.
- `unknown`: a previous attempt is uncertain; a fresh request is allowed.

Current generic Portal failures and Session Closed do not establish persistent
revocation, so they must not be labelled `revoked`. A denied or invalid restore
may cause the OS to offer consent within the same request. The product does not
infer that a dialog is visible from the mere existence of a pending request.

macOS keeps screen-recording and accessibility grants under TCC. X11 uses the
authenticated current-user desktop without adding a Portal flow. Neither shows
the Wayland persistence preference. This feature does not start the Runtime,
install services, elevate privileges, bypass lock screens or provide login access.

## Single-use Portal transaction

The upstream private directory and grant/lock files validate current-user
ownership, restrictive modes, regular files, schema and bounded content. Unsafe
paths, symlinks, corruption and future formats fail without overwriting data.
The `portal-start.lock` lease spans restoration, consent and token commit.

A saved credential is not removed merely by reading status or preparing a
request. Immediately before submission, its record becomes `unknown`, retaining
the bytes but preventing another attempt with the same single-use value.
`persist_mode=2` and `restore_token` are submitted only where supported.

After successful Start, a returned replacement token is durably staged before
opening PipeWire. Valid streams and an opened PipeWire descriptor allow the final
atomic `saved` commit. If media initialization fails or the process crashes after
staging, the successor remains recoverable. If submission outcome is uncertain
without a staged successor, the next connection requests consent normally instead
of replaying the old value. File replacement and directory synchronization preserve
the transaction across process death. Legacy v1 grants migrate on mutation.

Cancel and generic errors retain stored bytes; neither is falsely reported as
system revocation. Retaining bytes cannot resurrect a single-use token already
consumed by GNOME. This is an unavoidable distinction between pre-submission
failure and an uncertain request outcome.

# Boundaries

Session closure, removed displays and invalid media revoke live input, clipboard,
audio and painted authority under the [desktop session contract](remote-desktop.md).
The next attachment attempts a saved successor grant. Old connections and
generations cannot transfer authority to it.

# Evidence

- `internal/config/config.go` and `internal/config/remote_desktop_test.go`: effective migration and explicit opt-out.
- `internal/codeapp/appserver/remote_desktop.go` and `internal/codeapp/appserver/remote_desktop_test.go`: settings persistence, policy response and full permission.
- `internal/remotedesktop/authorization.go` and `internal/remotedesktop/authorization_test.go`: private native reset, cancellation and viewer exclusion.
- `internal/remotedesktop/manager_test.go`: server preference wins over viewer input.
- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.test.tsx`: truthful saved-state guidance and explicit reset confirmation.
- Current published host-desktop portal implementation and `host_desktop_portal_test.py`: private credential transaction, request lifecycle and failure tests.
