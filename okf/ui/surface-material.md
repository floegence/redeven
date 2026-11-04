---
type: UI Contract
title: Shared surface material
tags: [ui, desktop, flower, themes, performance]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Published Floe owns material and motion. Env App/Welcome select soft-neumorphic roles while business content stays flat. Preserve input, portals, widget identity and hot interaction ownership. Resolve conflicts at the product override source without copying shadow logic or introducing another theme/dependency owner.

# Contract

## Configuration and ownership
Both first-party renderers set `theme.defaultSurfaceStyle` to `soft-neumorphic`. The [published dependency contract](../architecture/env-app-upstream-web-dependencies.md) owns exact package versions and registry requirements.

## Activity icon states
Published Floe owns the 24-unit rounded rail family, 1.5-unit strokes, 13% idle faces and filled selected silhouettes. Desktop Activity Bar and mobile tabs pass their real active or expanded state; hover changes ink without selecting. Monitoring remains a rounded pulse with a soft area and Switch Environment keeps slender opposing arrows. Web Services remains a globe. Plugin launcher disclosure fills while open without changing the selected page; environment switching is momentary.

Redeven's adapters consume the published icons subpath. Flower reuses the product's canonical five-petal artwork: each petal meets beneath the yellow center. Its navigation variant follows the host's size and active state, with outlined idle petals and selected ink-filled petals separated by visible surface-colored seams. Geometry remains stable through selection; ordinary brand and Workbench artwork retain their existing treatment. Shared icon detail masks reveal each theme's actual surface, and forced colors use system navigation ink. Verify live selection, disclosure, mobile editor retention, petal-seam contrast and icon contrast; never replace these with static SVG-only checks.

## Product presentation
Ordinary shared Buttons, Cards, Radio, Checkbox, Switch, Tabs, progress controls, Dialogs, and FloatingWindows use their released component treatment. Hover must preserve the selected fill and text.

The plugin launcher keeps its existing action and localized name; artwork owns no input or navigation behavior.

## Flower composer and disclosures
The expanded composer consumes Floe field fill and edge with one stable writing boundary. Chat focus transfers between editor, toolbar, menus and threads do not recolor the frame; internal controls retain keyboard focus feedback. Dedicated pages preserve the top editing inset and nest the permission capsule and send circle at equal 8px side/bottom insets. Their shared size derives the outer corner radius so the lower arcs remain concentric, including the 1px border; chat, approval and input requests retain that outer frame, and touch controls retain 44px targets. Compact companions retain Floe panel radius, their existing height and editor identity. Floating model, permission, reasoning, More, reference, command, Goal, context and conversation controls consume published material and presence. Exiting panels become inert and hidden from accessibility immediately, while Floe finishes the visual exit; reopening reverses that exit. Context menus retain their deliberate first-frame appearance.

Model and permission menus have one surface-owned lifetime, independent of inline/More toolbar placement. Published anchored layers own positioning and boundary clamping for model, permission, reasoning and More; animated children do not own geometry. Constraints are applied before first-paint measurement, so permission menus never appear below their final position and jump upward. Read-only, approval-required and full-access modes use the published Eye, ShieldCheck and Unlock icons consistently in the trigger, menu and toolbar measurement copy. Moving an open control into More retains its editor and focus. Hover context disclosures retain their content, scroll and expansion while hidden, with shared presence controlling paint.

Unavailable catalog models remain configured choices. A background availability update must not replace the composer with first-time setup or discard its draft, menu search or focus; unavailable models remain disabled for admission.

Cached Activity pages retain their last visible transcript gutter and toolbar allocation while hidden. Restoring a page must not resize the composer for a zero-width hidden measurement; saved thread-rail width is applied before the first visible layout.

# Boundaries

Use restrained static depth and short functional control motion. The progress disclosure remains clickable; failure and confirmation use static attention. Existing Workbench activation, wheel, text-selection, and preview/commit contracts remain authoritative.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/styles/redeven.css` - Source.

- `redeven:internal/envapp/ui_src/src/ui/icons/ActivityBarDockIcons.tsx` - Source.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.polish.browser.test.tsx` - Hidden-page geometry, shared material, focus, responsive layouts, reversal and reduced-motion acceptance.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.permissionStability.browser.test.tsx` - First-painted popup geometry, repeated focus transfers, captured page pixels, distinct mode icons, compact bottom inset and retained thread drafts.
