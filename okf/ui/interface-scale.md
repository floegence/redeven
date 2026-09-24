---
type: UI Contract
title: Shared interface scale
description: Apply one readable desktop type and control scale across Flower, Env App, and Desktop without shrinking content viewers or touch targets.
tags: [ui, flower, desktop, accessibility, typography]
timestamp: 2026-09-25T00:00:00Z
---
# Summary

Published Floe owns reusable typography, control dimensions, responsive input targets, and settings geometry. Redeven maps product roles to that released scale across Flower, Files, Git, runtime settings, monitoring, and Desktop Welcome. At a normal 16px root size, ordinary UI uses 13px text, conversation text uses 14px, and desktop actions use 28px or 32px targets. Touch and enlarged-text layouts grow naturally. No density preference, root-font reduction, transform scaling, or second theme state controls this behavior. A geometry failure is repaired at its owning component without changing permission, focus, draft, or scroll authority.

# Contract

## Type roles and boundaries

Env App and Desktop bundle the same Inter Variable font and use the same platform fallback stack for unsupported scripts. The root font size remains browser-controlled. Published Floe tokens define caption 11px, supporting text and buttons 12px, labels/navigation/file names 13px with a 20px line, ordinary text 14px with a 22px line, and page titles 14–16px. Weights are normally 400 or 500; content headings may use 600. Captions describe secondary metadata, never replace readable labels. Long localized labels wrap or retain exact accessible text.

Flower uses 14px/22px message text and compact paragraph spacing. Markdown retains heading hierarchy and exact code content. Tool operation labels use the UI face while commands retain the monospace face and 12px text. Terminal grids, editors, file/document previews, remote applications, and chart data keep their own content-font and zoom owners; interface scale never changes PTY geometry policy, editor preferences, document zoom, or remote pointer coordinates.

## Controls and density

Inline desktop actions use 28px targets; primary actions and ordinary fields use 32px. Flower's full-page header has a 44px minimum, and its title uses medium weight. Thread and file navigation use 32px rows, with natural growth for additional state. Settings use Floe's released 16px page heading, 12px row inset, and compact content spacing. Product markup does not copy shared settings geometry. Desktop Welcome, Codespaces, service and plugin identities follow the same quiet heading hierarchy.

Coarse-pointer shared controls and product controls retain at least 44px targets. Editable touch text is at least 16px. Natural wrapping, browser zoom, and long translations may increase row height. Actions must not overlap, clip, move outside their owning surface, or hide another input. Input focus changes only the existing border color through Floe's published input-focus contract.

## State and interaction

Scale is presentation only. Existing DOM and keyed approval identities remain mounted across theme changes, navigation, companion collapse, and resize. Pending commands lock only their existing action scope. Composer draft ownership, permission checks, atomic approval batches, focus handoff, and exact command copying remain defined by their canonical Flower contracts. [Approval geometry](flower-approval-surface.md) still constrains one scrolling list while retaining header and footer actions. Workbench wheel, reading selection, and floating coordinate ownership are unchanged.

# Acceptance

Browser checks measure real published-shell approval containment for 1, 2, 10, and 50 items, desktop and narrow widths, low height, coarse input, and zoom. Product checks assert header/action/text dimensions, file and thread row sizes, settings headings, retained focus/drafts, and Desktop toolbar alignment. Visual and interaction checks cover both materials, light/dark themes, and reading/scroll behavior. Dependency validation uses published packages only.

# Evidence

- `redeven:internal/flower_ui/src/styles/flower.css` - Flower typography, controls, and responsive geometry.
- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx` - Thread navigation roles and retained identity.
- `redeven:internal/envapp/ui_src/src/index.css` - Env App font entry and browser-controlled root scale.
- `redeven:desktop/src/welcome/index.css` - Matching Desktop font and control roles.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.approvalLayout.browser.test.tsx` - Real companion and full-page geometry.
- `redeven:internal/envapp/ui_src/src/styles/fileSurfaceRefinement.browser.test.tsx` - File rows and input focus.
- `redeven:internal/envapp/ui_src/src/ui/pages/RuntimeSettingsDesign.browser.test.tsx` - Settings scale and retained behavior.
- `redeven:desktop/scripts/check-welcome-toolbar.mjs` - Localized, zoomed, and narrow toolbar behavior.
