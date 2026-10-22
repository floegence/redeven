---
type: Interaction Contract
title: Remote desktop connection launcher
description: Identify the target host, explain connection readiness and open its desktop through one concise, localized flow.
tags: [desktop, applications, interaction, accessibility]
timestamp: 2026-10-09T17:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Env App launcher owns the remote desktop connection flow in Host Applications
and Workbench. It names the actual target, presents current readiness and offers
one primary action. Additional authorization advances inside that same surface.
Permission and platform limits remain enforced by the
[desktop session contract](remote-desktop.md). Failure stays visible with an
appropriate recovery step; dismissal before session creation finishes releases
that session. A successfully opened viewer retains its independent lifetime.

# Contract

## Target and readiness
Remote Desktop uses one monitor-and-pointer silhouette in its launcher and Workbench Dock. Their identities must remain distinct at Dock and widget-header sizes, in every shipped theme and high-contrast mode.

Failure retains its diagnostic and retry action, while cancellation stops only the selected setup operation; neither requires reloading the application.

## Continuous connection setup
When a target needs SSH service preparation, authorization and desktop opening remain one continuous flow in the existing Remote desktop dialog. The current step, operation-bound authorization challenge, progress, failure diagnostic and next action stay visible together.

Administrator scope and credential lifetime follow the [SSH deployment contract](remote-desktop-ssh-deployment.md).

## Connection options
The initial dialog presents host identity, readiness and one connect action. Opening the launcher never changes system permission.

Turning off reuse means each future connection requests host confirmation; it does not revoke the system grant.

# Boundaries

## Failure and window ownership
Status refreshes never erase a connection failure.

Desktop retains origin-only target validation and environment-scoped route admission; product adapters must not weaken either boundary to accept malformed session data.

# Evidence

- `internal/envapp/ui_src/src/ui/icons/RemoteDesktopIcon.tsx`: shared monitor-and-pointer silhouette and compact launcher rendering.

- `internal/envapp/ui_src/src/ui/icons/WorkbenchSoftIcons.tsx`: themed Remote Desktop Dock tile.

- `internal/envapp/ui_src/src/styles/navigationIcons.browser.test.tsx`: actual-size silhouettes, theme and high-contrast checks.
