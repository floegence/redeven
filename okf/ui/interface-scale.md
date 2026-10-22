---
type: UI Contract
title: Shared interface scale
description: Apply one measured desktop reading and control scale across Flower, Env App, and Desktop without shrinking content viewers or touch targets.
tags: [ui, flower, desktop, accessibility, typography]
timestamp: 2026-09-26T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe owns typography, control dimensions, responsive targets, settings geometry, and virtual file row measurements. Redeven maps product roles to that released scale across Flower, Files, Git, runtime settings, monitoring, services, plugins, Codespaces, and Desktop Welcome. At a browser-controlled 16px root and 100% zoom, desktop body text is 12px/20px and conversation titles are 13px/20px; ordinary host navigation remains 12px/18px, and ordinary single-line rows occupy 28px including inter-row spacing. Touch and enlarged-text layouts grow naturally. No density preference, root-font reduction, transform scaling, or second theme state controls this behavior. A geometry failure is repaired at its owning component without changing permission, focus, draft, or scroll authority.

# Contract

## Type roles and boundaries
Env App and Desktop bundle Inter Variable and use the same platform fallback stack for unsupported scripts. Product guidance, error messages, settings labels, and dialog copy must use their published body or control roles rather than fixed 13–14px sizes or generic utility sizes.

Root font size, browser zoom, and system magnification remain user-controlled.

## Controls and layout density
Inline desktop actions use 28px targets; primary actions and ordinary fields use 32px.

Groups stay 8px apart and the last action meets the trailing padding, so spare width never becomes an interior or trailing gap.

Input focus changes only the existing border color through Floe's published input-focus contract.

Density is measured on real components with published dependencies after font loading, recording source identity, loaded Floe version, font family, root size, DPR, and zoom. The fixed mixed-script Markdown sample at 434px and 758px must occupy no more than 90% of its frozen pre-change height.

Screenshots use matching content and dimensions; reference screenshots from another product do not establish its unmeasured CSS values.

# Boundaries

Scale is presentation only. Composer drafts, permissions, atomic approval batches, focus handoff, and exact command copying remain defined by their canonical Flower contracts. Workbench wheel, reading selection, and floating coordinate ownership are unchanged.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/BodyTypography.browser.test.tsx` - Real dialog/body/control roles, narrow fine-pointer versus touch fields, preserved headings and rename submission.

- `redeven:desktop/scripts/check-body-typography.mjs` - Real Welcome/access workflow and generated recovery/loading documents in Chromium and isolated Electron, root scaling, touch targets, measurements and screenshots.

- `redeven:internal/envapp/ui_src/src/ui/ResourceSurfacePolish.browser.test.tsx` - Complete permission guidance, host bounds, keyboard scrolling, and container title-band parity.
