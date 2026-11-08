---
type: Interaction Contract
title: Product accessibility for AI agents
tags: [ui, accessibility, computer-use, workbench]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Redeven owns accessible names/state/relationships while preserving layout, handlers, focus and inert exclusion. Scope claims accurately: accessibility edits alone certify neither WCAG nor model performance. Select uses combobox/listbox/option semantics; Dropdown remains an action menu.

# Contract

## Product semantics and unchanged interaction
Flower composer fields expose explicit localized names in both ordinary and private-input forms. Existing thread status, controls, menus, live announcements and collapsed/inactive view boundaries remain authoritative.

Adding roles must not claim keyboard behavior that a surface does not implement.

## Shared business-control localization
Env App, Desktop and Code App consume the coordinated Floe 0.87.0 release set. Env App I18nProvider supplies the published Floe LocaleProvider from its atomically activated locale dictionary. DesktopWelcomeShell uses DesktopFloeLocaleProvider over the existing launcher language snapshot and explicit Desktop catalogs. Desktop core remains a build-only dependency; both renderers pin the same published release and declare its optional Pele/KaTeX peers to preserve diagram rendering. Every shipped locale explicitly defines the full floeControls catalog; keys and placeholders match the upstream public vocabulary. Count labels use neutral labels plus a number so one template does not imply incorrect plural inflection. Language switches update mounted controls without a second locale owner. The product keeps document language/direction and existing domain-specific string adapters.

Form identity, validation relationships, popup keyboard ownership, native submission/reset, and civil-date mechanics belong upstream. Product adapters must consume released APIs rather than clone controls. TerminalLayoutPicker spreads the published Popover trigger binding onto its real button so the panel relationship follows upstream identity. Generic Calendar and Breadcrumb come from /ui; legacy umbrella meanings remain unchanged.

# Boundaries

## Shared gap decision and audit evidence
The audit of published floe-webapp 0.86.25 established that its Tabs item API exposed no per-tab DOM identity or controlled-panel target. TabPanel accepts `labelledBy`, but consumers cannot supply a corresponding tab identity through the public Tabs API.

Tests that deliberately filter cases qualify only the cases executed, never the whole product or platform matrix.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/i18n/floeControls.test.ts` - Tests.
