---
type: UI Contract
title: Runtime settings
tags: [ui, runtime, settings]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Env App owns settings destinations/drafts/API adapters; Floe reusable layout/navigation. Narrow/revisited panels retain usability, drafts and scroll. A ready editor has a compact version/source row with the update action. Installed versions and installation paths use keyboard-accessible disclosures; selection, removal confirmation and copying stay available.

# Contract

## Navigation and visual hierarchy
Destinations are Config File, Connection, Runtime Status, Shell & Workspace, Codespaces & Tooling, Logging, Permission Policy, Flower and Debug Console. Page-owned geometry avoids competing global/lazy styles. Full padded diagnostic summaries toggle native disclosure with neutral hover and visible keyboard focus.

## Codespaces and Browser Editor
The breadcrumb owns the visible destination label. The content has one Browser Editor heading, one status badge and one inventory refresh action. The settings installation surface omits its standalone heading and refresh control; initial setup shows the selected installation route and one primary action without an idle progress checklist or empty current-editor rows. Active setup shows the current stage once, measured progress, cancellation and diagnostics; errors retain explicit retry and failure details. Runtime permissions and install/update confirmations remain authoritative.

Port fields show their values directly, including disabled defaults. The effective range is explained only when normalization changes custom input; autosave and its flat API payload remain unchanged. Floe tokens set field heights, corners and text; setup actions wrap and progress adapts within narrow settings surfaces.

## Settings controls and identity
Runtime, Desktop environment, Flower, terminal and managed-service fields share the published Floe control height (32px, `--floe-control-height-md`), `--floe-radius-field` corners, 12px text, quiet fill and subdued 1px border. Row identity icons and provider brands occupy the same 32px square on `--floe-radius-md`, so icon, field and select edges stay concentric within a row. Floe owns keyboard, validation, menus and border-only focus. Scalar labels need no decorative icons.

## Configuration editing
Existing autosave/restart rules govern shell, filesystem, logging, ports and permissions. Settings PUT accepts flat fields, never response-group wrappers such as `runtime`/`logging`/`codespaces`. Health, diagnostics, backup/restore use right-column actions without bypassing permission/confirmation.

## Flower extension placement
[Flower extensions](flower-extensions.md) own Skills/MCP browsing and management.

# Boundaries

Read access cannot edit administrator fields. Runtime maintenance requires explicit user confirmation through its existing shared controller.

# Evidence

- `redeven:internal/config/config_update.go` and   `redeven:internal/config/config_update_test.go` own coordinated configuration   transactions, settings preservation, account removal, and failed writes.

- `redeven:internal/agent/gateway_membership_lifecycle_test.go`,   `redeven:internal/agent/control_artifact_source_test.go`, and   `redeven:internal/agent/cloud_link_test.go`

- `internal/envapp/ui_src/src/ui/pages/EnvSettingsPage.tsx`
