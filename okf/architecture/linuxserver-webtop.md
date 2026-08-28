---
type: Runtime Contract
title: LinuxServer Webtop
description: Install and update two digest-pinned interactive desktop containers without expanding host authority.
tags: [web-services, containers, desktop, security, updates]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

- Authority: Redeven's built-in template registry owns the two reviewed Webtop identities, platform digests, runtime profile, safety notice, and target revision; [Managed Web Services](managed-web-services.md) owns their generic lifecycle and protected access.
- Outcome: Ubuntu KDE and Debian XFCE appear as independent installable desktop services that persist configuration and expose one loopback-only Web endpoint.
- Invariants: no mutable tag, public listener, host namespace, privileged mode, GPU, device, Docker socket, capability addition, or second lifecycle implementation is permitted.
- Failure boundary: a missing acknowledgement, digest drift, runtime-policy mismatch, failed health check, or invalid update journal fails closed and preserves or restores the last verified release.

# Contract

## Reviewed templates

The Runtime exposes **LinuxServer Webtop · Ubuntu KDE** at `654ea8e3-ls177` and **LinuxServer Webtop · Debian XFCE** at `7c4ebdc9-ls209`. Their official `lscr.io/linuxserver/webtop` amd64 and arm64 image digests are compiled into the built-in registry. Each has its own template and service-family identity, `/config` volume, and space-free recommended directory at `Redeven/workspaces/managed-services/<service-family-id>` below the writable root, so both may run together. A user-selected writable workspace may still contain spaces. Redeven never resolves `latest`, copies a brand image, or treats upstream labels as runtime authority.

Catalog identity, source, order, Ubuntu or Debian distribution mark, localized copy, notice, and runtime specification are declarative fields from that registry. Renderer code only projects them and uses the official distribution glyphs under their published icon-license terms; it does not infer a mark from a template identifier. Installation and update accept `accepted_notice_revisions`; the Runtime requires the current revision of `interactive-desktop-root-and-network` and rejects missing, stale, or unknown values. The warning states that anyone authorized to open the desktop can gain root inside its container and that the container has outbound network access.

## Runtime profile

Both templates reuse the one generic single-container driver with the reserved `interactive_desktop` profile. Existing and custom container templates retain the restricted default and cannot select this profile.

The reviewed profile:

- keeps the image's original root entrypoint and writable root;
- sets `PUID` and `PGID` from the numeric Runtime user and uses the Runtime timezone;
- mounts a Redeven-managed persistent volume at `/config` and only the selected writable workspace at `/workspace`;
- sets `START_DOCKER=false`, `FILE_MANAGER_PATH=/workspace`, locks CPU rendering on, and disables and locks Webtop sharing and collaboration links;
- allocates exactly 1 GiB shared memory and a 2048 PID limit;
- uses bridge networking and publishes only container port `3000` to the assigned random `127.0.0.1` port.

Creation and every lifecycle action verify the exact digest-pinned image, Redeven ownership label, original root user, writable-root profile, resource limits, mount targets, absence of devices and capability additions, bridge namespace, absence of unconfined seccomp/AppArmor, and the single loopback publication. Webtop cannot receive privileged mode, host network/PID/IPC namespaces, a host Docker socket, GPU/device access, DinD, or direct Internet exposure through this contract.

## Reviewed update

The service view derives `update_available`, target revision, and target version only when the Runtime-owned built-in definition is newer than the installed immutable snapshot. Update reuses the existing managed operation and event stream.

Redeven first validates the notice revision, writes a versioned journal to the existing `runtime_manifest_json`, then pulls and verifies the target digest before stopping the old container. It replaces only the exact owned container and reuses the workspace, `/config` volume, desired running/stopped state, loopback port, and protected forward. After start and health verification, the target snapshot, revision, accepted notice, version, runtime identity, artifact, state, and cleared journal commit in one registry update.

Failure or cancellation removes only a verified target and recreates the previous exact artifact and state. At startup, a journal whose target reached the verified phase may be finalized only after exact inspection; every earlier phase rolls back. An invalid or ambiguous journal fails closed. The update adds no table or schema migration, rewrites no existing snapshot, and does not enable automatic image discovery or automatic upgrades.

# Boundaries

This contract covers only the fixed Ubuntu KDE and Debian XFCE variants on amd64 and arm64. It does not provide GPU acceleration, host Docker administration, nested Docker, automatic updates, mutable tags, alternative desktop variants, direct LAN/public exposure, or trust for every image published by LinuxServer.io.

# Evidence

- `redeven:internal/managedwebservice/builtin_templates.go` - Owns Webtop identities, per-platform digests, families, notices, environment, mounts, and profile selection.
- `redeven:internal/managedwebservice/custom_container.go` - Builds and verifies the generic interactive desktop runtime without host authority expansion.
- `redeven:internal/managedwebservice/update.go` - Owns pull-before-stop update phases, exact commit, rollback, cancellation, and interrupted recovery.
- `redeven:internal/portforward/registry/managed.go` - Atomically updates snapshot, revision, configuration, version, artifact, runtime identity, state, and journal.
- `redeven:internal/managedwebservice/webtop_test.go` - Covers artifacts, template independence, acknowledgement, profile restrictions, and digest drift.
- `redeven:internal/managedwebservice/update_test.go` - Covers running/stopped updates, rollback, cancellation, and interrupted recovery.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.test.tsx` - Covers two cards, workspace defaults, notice gating, update notice revisions, and the shared progress chain.
