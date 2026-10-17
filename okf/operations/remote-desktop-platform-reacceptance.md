---
type: Acceptance Record
title: Remote desktop platform reacceptance
description: Recheck actual GDM, GNOME lock, Portal and macOS behavior and trace the published Portal damage repair.
tags: [desktop, linux, macos, wayland, validation]
timestamp: 2026-10-17T01:46:00Z
---
# Summary

This record owns the 2026-10-17 UTC platform reacceptance evidence. The
[session](../architecture/remote-desktop.md) and
[media](../architecture/remote-desktop-media.md) contracts own authorization,
generation and pixel safety. Acceptance requires captured pixels and native input
receipts, preserving existing sessions and Runtime processes. Viewer/helper evidence stays distinct; failures remain visible.

# Contract

## Scope And Builds

Task-owned Desktop and Runtime instances used Redeven
`7230cf1ae40316efed23c6ff572d03656aded6cc`, compatibility epoch 62, with published
Go native v0.23.3, Swift native v0.22.27 and Electron 41.10.7. Builds used
`GOWORK=off` and published ReDevPlugin v3.0.35 without sibling wiring or overlays.
The Linux host was udesk26, Ubuntu 26.04.1, kernel 7.0.0-38-amd64, with its original
GNOME Wayland session retained. These are functional platform checks, not latency,
audio or hotplug qualification.

## Physical Desktop, GDM And Lock

The published root manager completed ensure with separate interruption consent
and actual Runtime admission proof before commit. The product Viewer painted
1920 x 1280 desktop pixels. Physical keyboard and pointer events changed native
GTK receipts; the private report retains the executable digest.

GDM CreateTransientDisplay opened a real seat0 tty1 greeter without logout.
The Viewer displayed its user list and password field. Private credential entry
returned to original GNOME session 8 on tty2; gnome-shell PID 9238 and Runtime
PID 98456 survived. The greeter retired normally. Reconnect supplied fresh pixels
and keyboard input reached the same fixture.

Lock host and separate confirmation produced LockedHint=yes and painted lock
pixels. Normal controls stayed unavailable until Start unlocking. An invalid
credential kept the host locked; private physical-key entry then unlocked the
same session. Reconnect retired paint authority before fresh pixels arrived.
Timing is not performance qualification.

## Portal Reproduction And Repair

The real current-user RemoteDesktop Portal displayed its OS consent dialog. With
v0.23.3, granting screen and input produced one H.264 frame and then
CAPTURE_LAYOUT_UNSUPPORTED. A traced diagnostic identified a stale VideoDamage
rectangle at y=1280, height=2 for a 1920 x 1280 stream. The MemFd, stride and full
pixel plane were valid. The advisory rectangle must not invalidate that plane.

Upstream `d3d4cb80ae36cdead38170b4252a48b191306e34` adds a red-to-green
regression and discards all advisory damage hints if any rectangle is outside
the surface, using the existing bounded full comparison. Metadata storage and
pixel-plane checks remain strict. No host-side repair path was added.

The immutable v0.23.4 module was acquired through the Go proxy and checksum
database. It prepared official component
`e39d6343428f947136b0c9ce1a7b30e50186ee57876cb7d3bfb1803e01d30cef` on udesk26.
The helper requested OS consent with input selected.
Ten H.264 frames decoded; native Entry text `l89` and pointer count 2 matched
the picture. Saved consent restored on reconnect: six fresh frames in a new
generation and input receipt `l890`. Forgetting authorization and canceling the
next OS dialog returned PERMISSION_CANCELLED and disconnected. A new probe
returned ready/needs_consent, proving recovery from canceled authorization.

The actual product Portal route was checked separately. A task Runtime's private
mount namespace hid the physical service only from that process. Its normal
authenticated Viewer ticket opened real OS consent. With input selected, Chrome
155 painted 1920 x 1280 WebCodecs frames. KeyP produced native text `p`, and a
pointer click produced count 1. Reload retired the old connection and restored
saved consent. Fresh pixels and KeyR produced `pr` at
2026-10-17T02:51:54.615590Z. Receipts are separate.

## Release Qualification Repairs

Failed candidate runs remain recorded and unpublished as GitHub Releases.
GNOME qualification now waits for decoded document layout (7d39d69) and observes
the public GTK Save action until asynchronous metadata/etag work completes
(288a222). Assertions retain exact UTF-8, Unicode, selection and multiline bytes,
without shortcut retries. Twenty local Ubuntu arm64 density-1/2 sequences passed;
they supplement native CI and do not replace it.

The temporary GTK fixture uses identical pinned Debian manifests from the original
publisher after ECR HTTP 429 (26f8248); historical binary provenance stays intact.
Native/browser workarea convergence shares one bounded check (8a41f8f), with a
red-to-green regression that still rejects a persistently stale workarea.

Sandbox runs observed absent systemd bus ownership, including immediately after
restart in v0.23.8. The reason the earlier owner disappeared remains unproven.
Disposable runners enable linger, restart their manager after native fault cases,
then await registration for at most ten seconds with kernel UID validation and
failure diagnostics (45fd43a). Flatpak GNOME receives its ordinary focus click
before focused IBus readiness and retains the application log (c9d0e35). These
fixture changes add no production policy changes or input retries.

v0.23.9 at 45fd43af06254acf004422d52f8fad4418d41b56 passed all 13 jobs in
Release qualification run 39003984361, including Release gate. Both architectures
passed complete managed/system Xpra, GTK ABI and twelve density repetitions;
each private-desktop job passed its ABI baseline, 19 native/fault cases and four
Snap/Flatpak cases. GitHub Release publication followed success. Go proxy and
checksum-database acquisition verified the module before Redeven consumption.
Production/component bytes match the actual v0.23.4 Portal build.

## macOS

Local Environment opened through the product launcher with existing TCC grants.
The Viewer painted the 2560 x 1440 Studio Display. Native NSWindow receipts showed
`mmrqz6` and one pointer click. Two reconnects each retired paint authority,
painted fresh frames and delivered input to the same fixture. First-time TCC, audio and hotplug are excluded.

# Evidence

Private evidence is archived at
`/Volumes/JianDisk/.codex-cc/artifacts/redeven-desktop-platform-reacceptance-20261016`. Screenshots contain user desktop pixels and are deliberately
not committed. The report records versions, digests and cleanup.
Key files:

- `gdm-first-picture.png`, `gdm-password-prompt.png`, `gdm-returned.png`;
- `linux-locked.png`, `linux-invalid-password.png`, `linux-unlocked.png`,
  `linux-reconnect.json`;
- `portal-v0234-after-input.png`, `portal-v0234-reconnected.png`,
  `portal-v0234-evidence/events.jsonl` and native application receipts;
- `portal-final-enabled.png`, `portal-final-picture.png`,
  `portal-product-input-receipt.png`, `portal-product-reconnected.png`;
- macOS screenshots and native application receipts in the same private directory.

# Boundaries

## Restoration

The host service unit and installed record were restored byte-for-byte against
the private pre-test snapshots. At 2026-10-17T03:16:24.151Z the original Runtime
reported ready with screen and input enabled. The active/enabled service, active/unlocked session 8 and original PIDs survived.
There was no pending deployment journal. Task Viewer sessions were deleted and
the task Portal authorization was explicitly forgotten. Task processes, the
disposable container, remote temporary state, local authentication profile, SSH
tunnel and exact temporary authorized-key entry were removed.

## Limits

A successful service start does not certify Runtime authentication or capture.
No logout, GDM restart, password-policy change, root SSH enablement or driver
installation was used. Passwords were submitted through a private terminal input
path to physical key events and were not stored in the harness, argv, environment
or diagnostics. Previously recorded deployment fault matrices remain separate
historical evidence; this run rechecks the four named platform behaviors.
