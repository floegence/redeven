---
type: Interaction Contract
title: Product accessibility for AI agents
description: Audit core product semantics while preserving visual presentation and existing input ownership.
tags: [ui, accessibility, computer-use, workbench]
timestamp: 2026-10-13T00:00:00Z
---
# Summary

Redeven owns product names, descriptions, business state and relationships for
Flower, Welcome, files, terminal and Workbench. Accessibility additions preserve
existing classes, dimensions, colors, spacing, animations, event handlers and
focus recovery. Hidden/inert views remain excluded. General controls and shared
focus/floating mechanisms belong to published floe-webapp packages. A shared gap
requires source and behavior evidence before any upstream work; Redeven consumes
only a released upstream version. Failed audits report their exact scope and
cannot be presented as full WCAG or model-performance qualification.

# Contract

## Product semantics and unchanged interaction

Flower composer fields expose explicit localized names in both ordinary and
private-input forms. Existing thread status, controls, menus, live announcements
and collapsed/inactive view boundaries remain authoritative. Private inputs
retain their native password behavior and Computer takeover boundary.

Files associate the existing path guidance/error text with the editor through
`aria-describedby`, preserve `aria-invalid`, and expose pending submission as
`aria-busy`. There is no new visible description or changed Enter/Escape/blur
handling. Repeated workspace instances use independent description identities.

The semantic terminal scrollbar identifies its existing viewport through
`aria-controls` and exposes pending history work through `aria-busy`. The
scrollbar's pointer behavior and current tab sequence stay unchanged. Terminal
output remains in the semantic renderer and `terminal.read`; no DOM text mirror
is introduced. Existing input bridge, IME, selection and history owners remain.

Welcome retains one active owner panel and inert mounted inactive panels. Its
localized owner names and native controls remain intact. Owner cards and settings
windows supply unique stable `domId`/`panelId` pairs through released Tabs APIs;
TabPanel uses matching `id`/`labelledBy`. Snapshot refresh preserves identities.
A single owner or settings panel without Tabs has no dangling `aria-labelledby`. Workbench retains the
published local interaction, wheel, text-selection and floating-layer boundaries.
Adding roles must not claim keyboard behavior that a surface does not implement.

# Boundaries

## Shared gap decision and audit evidence

The audit of published floe-webapp 0.86.25 established that its Tabs item API
exposed no per-tab DOM identity or controlled-panel target. TabPanel accepts `labelledBy`, but consumers cannot
supply a corresponding tab identity through the public Tabs API. Welcome's
Local/Cloud/Gateway owner tabs consequently have selection state and named
panels without a tab-to-panel relationship. This belongs to shared Tabs and is
reusable by unrelated tab workflows. DOM patching, replacing the shared control,
or copying its focus/navigation implementation would violate ownership. Redeven
semantic work and the product audit preceded the separate upstream change.
The fix is consumed through published floe-webapp 0.86.27 packages only.
Upstream SSR and browser tests cover relationships, independent groups, keyboard,
focus, pointer and unchanged pixels/styles; Redeven supplies only product IDs.
No local sibling checkout, overlay or copied shared control enters validation.

Focused Chromium axe checks cover Files, terminal, Flower and Workbench.
Semantic-only Flower auditing excludes the existing timestamp color-contrast
finding at `.flower-thread-card-time`, because this task preserves UI colors.
That finding is a separate visual-design follow-up, not an upstream semantic gap.
The Welcome filesystem request-count test also fails unchanged on the baseline
main commit (expects five calls, observes seven); it is not accessibility
regression evidence. Keep both findings visible rather than weakening assertions.

The existing Welcome tab-motion qualification also fails on unchanged main
`08f045b56` with published Core 0.86.25: populated Gateway cards are expected to
animate, while the existing entrance selector excludes `.redeven-gateway-card`.
The same assertion fails with this semantic change. Preserve its assertion and
animation behavior; this is a separate motion follow-up, not a Tabs relation gap.

Welcome's optional list-section heading also exposes an existing axe
`heading-order` best-practice finding when that heading is omitted. The focused
WCAG 2 A/AA card audit does not claim an exhaustive best-practice audit.

Welcome cards/settings, Files and Flower screenshot hashes, layout geometry and computed styles are
compared with and without semantic naming/description/control/busy attributes.
Welcome Chromium acceptance runs in en-US/zh-CN at 390/1200 widths, including
Local/Cloud/Gateway perspectives, mounted inert panels, retained settings,
keyboard navigation and close focus recovery. Existing browser tests cover path keyboard input, terminal structured keys and
IME, and projected Workbench editing/focus. Tests that deliberately filter cases
qualify only the cases executed, never the whole product or platform matrix.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - existing path guidance and per-instance description association.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx` - semantic terminal viewport and history controls.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - composer names and existing hidden/inert interaction boundaries.
- `redeven:desktop/src/welcome/EnvironmentCards.tsx` - owner tab/panel composition.
- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.tsx` - settings tab relationships through published API.
- `redeven:desktop/scripts/check-agent-accessibility.mjs` - Welcome axe, relationship, input and presentation qualification.
- [Floe v0.86.27 release](https://github.com/floegence/floe-webapp/releases/tag/v0.86.27) - independently published shared Tabs contract.
- `redeven:internal/envapp/ui_src/vitest.browser.config.ts` - screenshot and computed-presentation comparison.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.composition.browser.test.tsx` - accessibility and projected composition behavior.
