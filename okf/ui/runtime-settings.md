---
type: UI Contract
title: Runtime settings
description: Navigate and edit runtime configuration through consistent, responsive settings surfaces while preserving API and permission ownership.
tags: [ui, runtime, settings]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App owns the runtime settings destinations, localized copy, drafts, and API
adapters. Published Floe settings components own reusable layout, navigation,
section hierarchy, and responsive setting rows. Every destination stays usable
on a narrow viewport and preserves its draft and scroll position when revisited.
Configuration writes use the existing authenticated runtime APIs; readers can
inspect settings but cannot edit administrator fields. Failed operations retain
their input and show an actionable error. Runtime maintenance remains delegated
to the shared maintenance controller after explicit user confirmation.

# Contract

## Navigation and visual hierarchy
The nine destinations are Config File, Connection, Runtime Status, Shell & Workspace, Codespaces & Tooling, Logging, Permission Policy, Flower, and Debug Console.

Geometry lives with the settings page so global and lazy-loaded styles cannot compete for ownership.

The full padded summary activates the native disclosure; neutral hover and visible keyboard focus identify its bounds without promoting diagnostic content into a primary action.

## Settings controls and identity
Runtime, Desktop environment, Flower, terminal and managed-service settings share one product field treatment: 34px minimum height, 8px corners, 12px text, a quiet neutral fill and a subdued 1px border. Published Floe still owns keyboard operation, validation, menus and border-only focus; product styling never replaces those behaviors.

Scalar input labels do not need decorative identity icons.

## Configuration editing
Shell, filesystem, logging, port, and permission changes retain their existing autosave and restart requirements. `PUT /_redeven_proxy/api/settings` accepts flat request fields: response groups such as `runtime`, `logging`, and `codespaces` must not be sent as request wrappers.

Health, diagnostic and backup actions follow the same right-column arrangement; expanding diagnostics or reviewing restore retains the existing permission and confirmation boundaries.

## Flower extension placement
Skills and MCP belong to Flower. The [Flower extensions contract](flower-extensions.md) owns catalog operations, browsing, and extension management interactions.

# Boundaries

Read access cannot edit administrator fields. Runtime maintenance requires explicit user confirmation through its existing shared controller.

# Evidence

- `redeven:internal/config/config_update.go` and   `redeven:internal/config/config_update_test.go` own coordinated configuration   transactions, settings preservation, account removal, and failed writes.

- `redeven:internal/agent/gateway_membership_lifecycle_test.go`,   `redeven:internal/agent/control_artifact_source_test.go`, and   `redeven:internal/agent/cloud_link_test.go` verify saved ChatGPT bindings   survive connection maintenance, in-flight exchanges, and restart.

- `internal/envapp/ui_src/src/ui/pages/EnvSettingsPage.tsx` owns destinations,   selection, and retained panels.
