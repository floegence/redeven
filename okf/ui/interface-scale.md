---
type: UI Contract
title: Shared interface scale
tags: [ui, flower, desktop, accessibility, typography]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Published Floe owns type, controls and responsive rows; Redeven maps semantic roles without root scaling or a separate density setting. Desktop uses 13px body/control, 12px supporting and 11px captions. Published group spacing comes from role tokens. Measure real published components after fonts load, recording source/package identity, font, root, DPR and zoom.

# Contract

## Type roles and boundaries
Env App/Desktop bundle Inter Variable with shared script fallbacks. Guidance, errors, labels/dialogs use published roles, not ad-hoc fixed sizes or generic utilities. Root size, zoom and magnification remain user-controlled. [Message appearance](flower-message-appearance.md) owns the separate transcript reading scale.

## Controls and layout density
Inline desktop actions use 28px targets; ordinary primary actions/fields use 32px. [Settings fields](runtime-settings.md#settings-controls-and-identity) follow the same published 32px control height and `--floe-radius-field` corners rather than a product-local scale. Buttons take their height, padding, radius and type size from the published `size` primitive: `icon` for square icon actions, `md` for ordinary text actions, `lg` where a 36px target was already intended. Do not re-impose heights on top of `size`, because the merge helper lets a passed class silently defeat the primitive and neighbours diverge. Ordinary rows use 30px, with the terminal navigator retaining its documented 32px rows. Coarse pointers use 44px rows/targets, 14px body and at least 16px fields; focus changes only the existing border color.

Mixed-script Markdown at 434px/758px must fit within 90% of the frozen reference height. Compare matching content/dimensions; another product's screenshots do not establish CSS measurements.

# Boundaries

Scale is presentation only. Composer drafts, permissions, atomic approval batches, focus handoff, and exact command copying remain defined by their canonical Flower contracts. Workbench wheel, reading selection, and floating coordinate ownership are unchanged.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/BodyTypography.browser.test.tsx` - Tests.
