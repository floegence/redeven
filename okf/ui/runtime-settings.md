---
type: UI Contract
title: Runtime settings
tags: [ui, runtime, settings]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Env App owns runtime settings destinations, localized drafts and API adapters; published Floe owns reusable layout/navigation. Narrow layouts remain usable and revisited panels retain draft/scroll. Authenticated APIs own writes; readers cannot edit administrator fields. Failures preserve input, while maintenance uses its existing controller after explicit confirmation.

# Contract

## Navigation and visual hierarchy
Destinations are Config File, Connection, Runtime Status, Shell & Workspace, Codespaces & Tooling, Logging, Permission Policy, Flower and Debug Console. Page-owned geometry avoids competing global/lazy styles. Full padded diagnostic summaries toggle native disclosure with neutral hover and visible keyboard focus.

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

- `redeven:internal/agent/gateway_membership_lifecycle_test.go`,   `redeven:internal/agent/control_artifact_source_test.go`, and   `redeven:internal/agent/cloud_link_test.go` verify saved ChatGPT bindings   survive connection maintenance, in-flight exchanges, and restart.

- `internal/envapp/ui_src/src/ui/pages/EnvSettingsPage.tsx` owns destinations,   selection, and retained panels.
