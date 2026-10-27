---
type: UI Contract
title: Plugin package review
description: Review official updates and external packages against exact Host-verified source and permission evidence.
tags: [ui, plugins, review, lifecycle]
timestamp: 2026-09-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

ReDevPlugin owns package inspection, validation, and atomic lifecycle mutation. Redeven presents the exact candidate, source evidence, permissions, and confirmation before submitting through released APIs. Cancellation affects only pre-submit inspection. Unknown mutation outcomes require inventory reconciliation instead of resubmission. Updates retain saved components and use fresh authorized slots after reconciliation; only confirmed uninstall removes their placement.

# Contract

## Update review and confirmation
Plugin Center's Updates card and inspector expose one primary `Review update` action.

Opening it creates an exact update intent, shows the loading review in the same interaction, and never submits a mutation, changes tabs, or replaces the current selection.

Closing completion preserves the Updates tab, clears obsolete exact selection, and shows an `All plugins are up to date` success state when no updates remain.

## External package review
Administrators may start installation or update from a compatible public HTTPS package URL, public GitHub repository Release with optional tag, or local `.redevplugin` file. The product submits the source and intent to the released inspection API; it never downloads remote bytes in the browser, parses the package, chooses trust state, or invents provenance.

A refresh failure after a terminal install exposes only an inventory refresh recovery and never a second install action.

# Boundaries

[Plugin surfaces](plugin-surfaces.md) owns discovery and management navigation. Inspection and commit always bind released Host identities. Review cannot accept stale candidates, infer permission from source trust, or replay an uncertain update.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginUpdateReviewDialog.tsx:1` - Owns update review and result presentation.

- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginUpdateProjection.ts:1` - Binds exact update target and candidate identity.
