---
type: UI Contract
title: Shared interface scale
description: Apply one measured desktop reading and control scale across Flower, Env App, and Desktop without shrinking content viewers or touch targets.
tags: [ui, flower, desktop, accessibility, typography]
timestamp: 2026-09-26T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Published Floe owns typography, dimensions, responsive targets and virtual rows; Redeven maps product roles to it. At 16px root/100% zoom, desktop body is 12px/20px, conversation titles 13px/20px, navigation 12px/18px and ordinary rows 28px including spacing. Touch/enlarged text grows naturally. No density setting, root shrink or transform changes scale.

# Contract

## Type roles and boundaries
Env App/Desktop bundle Inter Variable with shared script fallbacks. Guidance, errors, labels/dialogs use published roles, not fixed 13–14px or generic utilities. Root size, zoom and magnification remain user-controlled. [Message appearance](flower-message-appearance.md) owns the separate transcript reading scale.

## Controls and layout density
Inline desktop actions use 28px targets; ordinary primary actions/fields use 32px. [Settings fields](runtime-settings.md#settings-controls-and-identity) follow the same published 32px control height and `--floe-radius-field` corners rather than a product-local scale. Buttons take their height, padding, radius and type size from the published `size` primitive: `icon` for square icon actions, `md` for ordinary text actions, `lg` where a 36px target was already intended. Do not re-impose heights on top of `size`, because the merge helper lets a passed class silently defeat the primitive and neighbours diverge. Groups are 8px apart with the last action at trailing padding; focus changes only the existing border color.

Measure real published components after fonts load, recording source/package identity, font, root, DPR and zoom. Mixed-script Markdown at 434px/758px must fit within 90% of the frozen reference height. Compare matching content/dimensions; another product's screenshots do not establish CSS measurements.

# Boundaries

Scale is presentation only. Composer drafts, permissions, atomic approval batches, focus handoff, and exact command copying remain defined by their canonical Flower contracts. Workbench wheel, reading selection, and floating coordinate ownership are unchanged.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/BodyTypography.browser.test.tsx` - Real dialog/body/control roles, narrow fine-pointer versus touch fields, preserved headings and rename submission.
