---
type: UI Contract
title: Plugin package review, installation and saved-data recovery
tags: [ui, plugins, review, lifecycle]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

All plugin sources share released package inspection, exact review and durable installation. Official/community classification changes display only. Permissions remain independent explicit decisions; unknown effects reconcile from durable receipts without replay.

# Contract

## Package review

Market installs automatically inspect the selected repository/release/asset and expected package/security/contract hashes. Direct installation accepts HTTPS, GitHub repository or uploaded `.redevplugin` bytes. Multi-plugin repositories expose one selection step. No plugin signature, publisher trust badge, official-only wizard or separate client protocol exists.

Updates inspect the installed original source before presenting a candidate. Changing source requires explicit consent. Same-version changed contents and downgrades are blocked in update review. Changed revision/identity or expired inspection invalidates consent. Missing or changed security evidence requires explicit review; no market preview substitutes for current Host inspection.

Lead with verified localized identity and versions. Show access changes and saved-data conversion once; collapse technical declarations, limits, hashes and source facts. Worker/storage methods imply no broad host access.

Dialogs provide scrollable content, visible actions, keyboard focus, localization, touch targets and reduced motion. Progress retains identity. Cancellation fences late replies; source edits clear repository selection and market expectations.

One concise consent confirms the exact package. Installation enables the plugin without granting permissions. Both official and community packages direct later access decisions to installed details. Surface launch targets come only from Host `action_state` and per-Surface authority; missing permission leads to permission review, never a synthetic Enable/grant sequence.

## Installation progress

The Shell observes owner-scoped durable receipts and Execution progress. First installations can be recovered without an installed inventory row. Closing Plugin Center does not cancel admitted execution. Owner changes clear observers; reconnect restores receipts. Concurrent submits share one request, and lost replies query the same request ID.

A committed receipt remains committed even if post-commit execution or inventory refresh fails. Refresh retries only reconciliation. Unknown outcomes neither replay nor erase data. Definite failure requires a new review. Retained data uses the dedicated released recovery APIs, never automatic deletion followed by install.

Both update paths close affected slots, retire authority, preserve layout and reconcile inventory through the placement coordinator. Completion offers opening only when current inventory permits it.

# Boundaries

[Surfaces](plugin-surfaces.md#discovery-and-surfaces) owns navigation and placement. [Package lifecycle](../architecture/redevplugin-package-lifecycle.md) owns source and automatic-update rules. ReDevPlugin owns package validation, durable receipts, permissions and execution; UI adds no parser, receipt database, implicit grants or uncertain replay.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.tsx` - Unified installation review.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginUpdateReviewDialog.tsx` - Update review.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInstallCoordinator.ts` - Durable receipt presentation.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx` - Responsive and accessible review acceptance.
