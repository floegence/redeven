---
type: Product Interaction Contract
title: Browser and desktop settings
description: Separate environment capability, Chrome pairing, conversation target selection, and grants in one shared settings surface.
tags: [ai, computer-use, settings, desktop, envapp]
timestamp: 2026-09-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns one Browser and desktop dialog shared by Desktop and Env App.
ComputerUseRuntime supplies current host capability and resource discovery;
existing thread settings own selection and access grants; the Chrome extension
owns confirmed pairing consent. These facts never substitute for one another.
Opening, refreshing, or leaving settings never selects a page, grants access,
starts a task, installs components, or launches a private desktop. Failed reads
remain unknown, and a lost selected object remains unavailable until recovered
or explicitly replaced. Floret remains the sole conversation lifecycle owner.

# Contract

## Overview and navigation
The overview identifies the actual Runtime hostname and platform, then shows the page or app used by the current conversation and three environment entries: built-in headless browser, Chrome in this environment, and desktop/applications. Opening or enabling never downloads.

Both carriers provide complete explicit localized copy.

## Runtime observation and recovery
`GET computer/environment` returns hostname, platform, managed-browser capability, desktop capability, and the existing live Chrome status snapshot. Capability is an observation, not an authorization or a guarantee that subsequent startup cannot fail.

Published Floe components already supply the required UI primitives, so this change is product integration rather than an upstream platform extension.

# Boundaries

Inspection never selects a page, grants authority, starts a task or installs components. A lost selection stays unavailable until it is recovered or explicitly replaced; the settings dialog does not own Floret lifecycle.

# Evidence

- `redeven:internal/flower_ui/src/FlowerComputerConnections.tsx` - shared dialog and staged operations.

- `redeven:internal/flower_ui/host/computerUseAdapter.ts` - one carrier-neutral Runtime adapter.

- `redeven:internal/flower_ui/src/settings/FlowerSettingsSurface.tsx` - global entry to the same dialog.
