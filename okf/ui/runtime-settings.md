---
type: UI Contract
title: Runtime settings
tags: [ui, runtime, settings]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Env App owns settings destinations/drafts/API adapters; Floe reusable layout/navigation. Narrow/revisited panels retain usability, drafts and scroll. A ready editor has a compact version/source row with the update action. Installed versions and installation paths use keyboard-accessible disclosures; selection, removal confirmation and copying stay available.

# Contract

## Unified settings host
Env App and Desktop open one global Settings dialog above the current work surface. Activity, Workbench, terminal sessions, plugin surfaces, Flower drafts and scroll retain their owners; opening settings is not work navigation. Published Floe owns retained DOM, modal placement, focus, nested Escape and inert exit. Create the stable retained owner inside the global placement provider: moving DOM cannot transfer Solid context to nested dialogs. Its root owns definite dimensions. Desktop caps the host at 1060 by 760 pixels; narrow screens use the viewport. Search filters navigation; mobile uses the same category targets. Desktop environment selection names the exact target; opening never starts a Runtime.

Env categories cover Appearance & Language, Connection, Runtime Status, Terminal, Browser, Applications & Desktop, Services, Shell & Workspace, Codespaces & Tooling, Permission Policy, Flower, Extensions, Plugin Center, Storage & Recovery, Config File, Logging and Debug Console. Desktop offers its applicable appearance, environment connection, Flower, extensions and browser sections. Header/mobile commands and contextual gears route here. Access-gate language remains available before authorization.

Env links use `settings` and optional `settings_resource`; Back/Forward restores selection. Unknown/unsupported resources show an unavailable state, never another service, thread or environment. Contextual terminal/browser/service/connection editors register their exact owner, keep drafts across category changes, and unregister on domain close. Closing the host closes its contextual session; stale links cannot revive it. Generic forms retain their scope-owned drafts. All nested dialogs follow exact host presence/category/resource support, separately from draft and operation ownership.

Host authority changes abort settings reads and reject late replies. Current admin/connection rights gate mutations; cached permission observations are insufficient. Independent provider saves do not depend on unrelated parent loading and publish success once. Settings covers Flower read visibility until modal exit. Installation transfers already admitted to an environment remain owned by that environment, not its visible settings panel or the current default model owner. Renderer grants and native explicit lookup bind the captured running incarnation; changing the selection cannot cancel or retarget admitted bytes, and a stopped/replacement Runtime rejects them.

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

- `internal/settings_ui/src`: product navigation and retained host adapters.
- `EnvSettingsDialog.browser.test.tsx`, `UnifiedSettings.browser.test.tsx`: real-host targets, drafts, portals, history, Escape, responsive geometry and live authority.
- `HostAccess.browser.test.tsx`: real-host application/desktop access controls, scoped nested setup, focus return, explicit helper recovery, localization, narrow layouts and accessibility.
- `scripts/check_unified_settings.mjs`: bounded source ownership gate; `scripts/check_unified_settings_acceptance.sh`: explicit behavioral qualification.
