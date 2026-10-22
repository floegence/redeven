---
type: Desktop Contract
title: Desktop environment settings
description: Open one target-bound settings session, preserve independent drafts, and save through the registered owner.
tags: [desktop, environments, settings, interaction]
quality_exception: One target-bound settings session joins connection drafts, access prerequisites, and restart recovery; keep their cross-domain authority and focus handoff together.
timestamp: 2026-10-12T06:30:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop owns one settings window and one opening session per Environment. Opening
never waits for a Runtime access read and a failed read never selects another
editor. Registration ownership determines available sections; every access read
and write carries an explicit Environment ID and resolves its registered
management authority. Runtime owns access configuration. A failed operation
preserves input and reports its real diagnostic; an obsolete response cannot
change a newer opening. Cloud, URL and Gateway registrations cannot read or save
Local access settings.

# Contract

## Sections and authority
Local opens Access & security and has no connection editor. Access management uses existing WSL authority only after discovery confirms that exact distribution is running; opening settings or automatic loading never starts a stopped distro.

Current process password constraints remain distinct from saved next-start configuration.

## Opening, drafts and saves
One opening owns the committed connection baseline, connection draft and lazily loaded access baseline and draft. Background health revalidation preserves the observed running summary, connection nodes, expanded listeners, address filters, selection, scroll and QR panels; it never reloads access, certificate or security configuration.

Starting a save invalidates older reads; late failure from a closed opening is a notification, never an error in the next editor.

## Access tasks and recovery
Access opens a task overview for current connection, browser access, sign-in protection and HTTPS certificate.

Recovery-pending protection must be restored before that change.

The [settings presentation contract](desktop-environment-settings-presentation.md) owns window geometry, theme material, section hierarchy, responsive controls, address disclosures, workflow inputs, focus affordances and visual transitions.

# Boundaries

[Verified access routes](desktop-environment-access.md) owns identity association and locally saved access defaults.

SSH field and secret details are owned by [SSH environment settings](desktop-ssh-environment-settings.md).

# Evidence

- `redeven:desktop/scripts/check-settings-hit-targets.mjs` - Clicks inside tab and action padding, keyboard switching, multilingual narrow layouts and touch target dimensions.

- `redeven:desktop/scripts/check-settings-restart.mjs` - Full Welcome shell acceptance for Local, SSH, WSL and container restart handoff, focus, dismissal, retry, narrow layouts and reduced motion.

- `redeven:desktop/scripts/check-settings-expansion.mjs` - Per-frame window, footer and disclosure measurements, rapid reversals, immediate focus exclusion and reduced motion.
