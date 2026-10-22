---
type: Acceptance Record
title: Remote desktop platform reacceptance
description: Recheck actual GDM, GNOME lock, Portal and macOS behavior and trace the published Portal damage repair.
tags: [desktop, linux, macos, wayland, validation]
timestamp: 2026-10-17T01:46:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

This record owns the 2026-10-17 UTC platform reacceptance evidence. The
[session](../architecture/remote-desktop.md) and
[media](../architecture/remote-desktop-media.md) contracts own authorization,
generation and pixel safety. Acceptance requires captured pixels and native input
receipts, preserving existing sessions and Runtime processes. Viewer/helper evidence stays distinct; failures remain visible.

# Contract

## Scope And Builds
Task-owned Desktop and Runtime instances used Redeven `7230cf1ae40316efed23c6ff572d03656aded6cc`, compatibility epoch 62, with published Go native v0.23.3, Swift native v0.22.27 and Electron 41.10.7. These are functional platform checks, not latency, audio or hotplug qualification.

## Physical Desktop, GDM And Lock
The published root manager completed ensure with separate interruption consent and actual Runtime admission proof before commit.

Timing is not performance qualification.

## Portal Reproduction And Repair
The real current-user RemoteDesktop Portal displayed its OS consent dialog. A traced diagnostic identified a stale VideoDamage rectangle at y=1280, height=2 for a 1920 x 1280 stream.

Receipts are separate.

## Release Qualification Repairs
Failed candidate runs remain recorded and unpublished as GitHub Releases.

Native/browser workarea convergence shares one bounded check (8a41f8f), with a red-to-green regression that still rejects a persistently stale workarea.

Production/component bytes match the actual v0.23.4 Portal build.

## macOS
Local Environment opened through the product launcher with existing TCC grants. First-time TCC, audio and hotplug are excluded.

# Boundaries

## Restoration
The host service unit and installed record were restored byte-for-byte against the private pre-test snapshots. Task processes, the disposable container, remote temporary state, local authentication profile, SSH tunnel and exact temporary authorized-key entry were removed.

## Limits
A successful service start does not certify Runtime authentication or capture. Previously recorded deployment fault matrices remain separate historical evidence; this run rechecks the four named platform behaviors.

# Evidence

- `gdm-first-picture.png`, `gdm-password-prompt.png`, `gdm-returned.png`;

- `linux-locked.png`, `linux-invalid-password.png`, `linux-unlocked.png`,   `linux-reconnect.json`;

- `portal-v0234-after-input.png`, `portal-v0234-reconnected.png`,   `portal-v0234-evidence/events.jsonl` and native application receipts;

Private evidence is archived at `/Volumes/JianDisk/.codex-cc/artifacts/redeven-desktop-platform-reacceptance-20261016`. Key files:
