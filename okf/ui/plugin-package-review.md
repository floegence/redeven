---
type: UI Contract
title: Plugin package review
tags: [ui, plugins, review, lifecycle]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

ReDevPlugin owns inspection, validation and atomic mutations. Redeven presents the exact candidate/source/permissions before confirmation. Cancel affects only pre-submit inspection; unknown effects require reconciliation without replay. Updates preserve layout with fresh slots; only confirmed uninstall removes it.

# Contract

## Update review and confirmation
Plugin Center's Updates card and inspector expose one primary `Review update` action.

Opening it creates an exact update intent without a mutation or navigation change. Official updates immediately present the validated market preview associated with that release; they do not refresh the whole market or download an external package to prepare review. Missing previews load only the selected plugin detail for the same generation and release. External sources still use the released package-inspection API.

Official confirmation carries the reviewed full release reference, including metadata and package digests, plus the installed management revision. A changed generation, release reference or revision invalidates consent; the client never substitutes a same-version replacement. Post-submit reconciliation refreshes installed inventory only. Canceled or superseded reads cannot replace the current dialog.

Install and update dialogs size to content within viewport bounds. Identity and versions remain visible through preparation, submission and completion; brief states do not reserve a full-height shell. Long review content scrolls independently of the footer. Access requirements appear once, with concrete destinations and process/background authority visible; technical limits expand on demand.

Closing completion preserves the Updates tab, clears obsolete exact selection, and shows an `All plugins are up to date` success state when no updates remain.

## External package review
Administrators may start installation or update from a compatible public HTTPS package URL, public GitHub repository Release with optional tag, or local `.redevplugin` file. The product submits the source and intent to the released inspection API; it never downloads remote bytes in the browser, parses the package, chooses trust state, or invents provenance.

A refresh failure after a terminal install exposes only an inventory refresh recovery and never a second install action.

## Concise decision surface

The external review leads with Host-verified, locale-resolved author presentation, publisher and version. Package identifiers are technical evidence, not substitute product names when presentation exists. Verified identity is a quiet inline state; only unverified, blocked or revoked assessments receive a warning. The visual four-step timeline and generic introductory description are omitted; progress remains available to assistive technology.

Before consent, concrete destinations, requested host permissions, credentials, processes, background activity and host-facing methods remain visible. Ordinary worker methods and plugin-owned storage operations do not become broad "delete content" permission counters. Explicitly dangerous and unknown effects remain visible regardless of route. Full declarations, diffs, source evidence, hashes and inspection binding remain under a keyboard-operable package-details disclosure.

Network destinations share one access heading, with update changes marked beside the affected destination. Storage, process and background changes remain visible on their access rows. Removed declarations remain available in the full report.

Surface storage and settings access comes from the released verified security
summary, including packages with settings but no storage namespace or Worker.
The saved-data row includes those declarations in official and external review;
exact Surface/store/operation facts remain in a collapsed technical disclosure.
Resource changes mark the saved-data row, while label-only Surface changes do
not. Writable Surface resources join the sensitive-declaration projection but
never become host filesystem permissions or automatic grants.

One short checkbox confirms the exact inspected package. Signature validity never substitutes for consent. The review cannot claim that installation or grants already occurred; completion cannot infer permission grants from enabled state. Unknown outcomes preserve the inspection identity and reconciliation behavior. Long names and translations wrap, mobile controls retain touch targets, and footer actions remain visible.

External package installation does not grant permissions. Its detail copy states that access is managed after installation; the separate official-install approval flow retains its existing reviewed-permission contract.

# Boundaries

[Plugin surfaces](plugin-surfaces.md) owns discovery and management navigation. Inspection and commit always bind released Host identities. Review cannot accept stale candidates, infer permission from source trust, or replay an uncertain update.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginUpdateReviewDialog.tsx:1` - Owns update review and result presentation.

- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginUpdateProjection.ts:1` - Binds exact update target and candidate identity.
