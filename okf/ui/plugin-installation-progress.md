---
type: UI Contract
title: Official installation progress
description: Observe durable official installation without coupling it to a management page or saved placement.
tags: [ui, plugins, review, lifecycle]
timestamp: 2026-09-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

ReDevPlugin owns the durable official-install Execution and its progress, idempotency, and recovery. Redeven observes that authority, presents exact market review and permission setup, and retains the operation when management closes. Response loss never creates a second installation. Only current authoritative inventory can expose a launch target; failed setup cannot revive stale permissions or remove saved canvas components.

# Contract

## Official installation progress
The pre-install interaction has one target-owned flow: `idle`, `review_ready`, `installing`, then `installed`; task failure is owned only by the shared install projection.

Cards and inspector share the same accessible `aria-busy`, live-status, alert, and progress projection.

# Boundaries

[Plugin surfaces](plugin-surfaces.md) owns discovery and management navigation. Package, trust, execution, and permission authority remain in released ReDevPlugin; these UI workflows cannot add a parser, mutation receipt store, or permission grant.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Presents review and installation state.

- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApprovedInstallSetup.ts:1` - Completes only permitted post-install setup.
