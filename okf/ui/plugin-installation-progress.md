---
type: UI Contract
title: Official installation progress
tags: [ui, plugins, review, lifecycle]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

ReDevPlugin owns durable official-install Execution, progress and recovery. Redeven presents exact review/permission setup and retains work after management closes. Lost replies cannot reinstall; only current inventory exposes launch, and failed setup preserves saved layout.

# Contract

## Official installation progress
The pre-install interaction has one target-owned flow: `idle`, `review_ready`, `installing`, then `installed`; task failure is owned only by the shared install projection.

Cards and inspector share the same accessible `aria-busy`, live-status, alert, and progress projection.

Install and update share one official-access presentation. Review, progress, errors and completion use content-height dialogs with a bounded scroll body and visible footer. Completion retains the current installed identity and setup-attention state instead of implying access was granted.

# Boundaries

[Plugin surfaces](plugin-surfaces.md) owns discovery and management navigation. Package, trust, execution, and permission authority remain in released ReDevPlugin; these UI workflows cannot add a parser, mutation receipt store, or permission grant.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Source.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApprovedInstallSetup.ts:1` - Source.
