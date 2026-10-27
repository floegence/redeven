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

Desktop/Env App share one Browser and desktop dialog. Runtime capability, thread selection/grants and extension consent are separate authorities. Open/refresh/close never selects, grants, runs, installs or launches. Failed reads stay unknown; lost selections remain unavailable until recovery/replacement. Floret alone owns conversation lifecycle.

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

- `redeven:internal/flower_ui/src/settings/FlowerSettingsSurface.tsx` - global entry to the same dialog.
