---
type: UI Contract
title: Plugin package review
tags: [ui, plugins, review, lifecycle]
lifecycle: contract
reviewed_at: "2026-10-30"
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

## Concise decision surface

The external review leads with Host-verified, locale-resolved author presentation, publisher and version. Package identifiers are technical evidence, not substitute product names when presentation exists. Verified identity is a quiet inline state; only unverified, blocked or revoked assessments receive a warning. The visual four-step timeline and generic introductory description are omitted; progress remains available to assistive technology.

Before consent, concrete destinations, requested host permissions, credentials, processes, background activity and host-facing methods remain visible. Ordinary worker methods and plugin-owned storage operations do not become broad "delete content" permission counters. Explicitly dangerous and unknown effects remain visible regardless of route. Full declarations, diffs, source evidence, hashes and inspection binding remain under a keyboard-operable package-details disclosure.

Network destinations share one access heading, with update changes marked beside the affected destination. Storage, process and background changes remain visible on their access rows. Removed declarations remain available in the full report.

One short checkbox confirms the exact inspected package. Signature validity never substitutes for consent. The review cannot claim that installation or grants already occurred; completion cannot infer permission grants from enabled state. Unknown outcomes preserve the inspection identity and reconciliation behavior. Long names and translations wrap, mobile controls retain touch targets, and footer actions remain visible.

External package installation does not grant permissions. Its detail copy states that access is managed after installation; the separate official-install approval flow retains its existing reviewed-permission contract.

# Boundaries

[Plugin surfaces](plugin-surfaces.md) owns discovery and management navigation. Inspection and commit always bind released Host identities. Review cannot accept stale candidates, infer permission from source trust, or replay an uncertain update.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginUpdateReviewDialog.tsx:1` - Owns update review and result presentation.

- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginUpdateProjection.ts:1` - Binds exact update target and candidate identity.
