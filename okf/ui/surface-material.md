---
type: UI Contract
title: Shared surface material
tags: [ui, desktop, flower, themes, performance]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Published Floe owns material and motion. Env App/Welcome select soft-neumorphic roles while business content stays flat. Preserve input, portals, widget identity and hot interaction ownership. Resolve conflicts at the product override source without copying shadow logic or introducing another theme/dependency owner.

# Contract

Both first-party renderers set `theme.defaultSurfaceStyle: soft-neumorphic`; [published dependencies](../architecture/env-app-upstream-web-dependencies.md) own versions/registry requirements. Use released Button/Card/selection/progress/Dialog/FloatingWindow treatments; hover preserves selected fill/text. Business content stays flat.

## Checkbox states
Unchecked faces remain hollow with a visible 1px control edge; checked/mixed faces use primary fill and a check/minus. Disabled faces retain the distinction. Published Floe owns this recipe and 24px/44px pointer targets. Single-line faces center within those targets; description controls retain first-line alignment. Model names and choices share the published small-control row scale and native labels with stable inputs; metadata and edit/reset actions remain independent. Acceptance checks state shape/contrast, repeated selection, focus/scroll continuity and saved intent.

## Icons
Consume Floe's icons subpath: 24-unit rounded rails,1.5-unit strokes,13% idle faces/filled selection. Desktop Activity Bar/mobile tabs pass actual active/expanded state; hover changes ink only. Monitoring uses rounded pulse/soft area, Switch Environment opposing arrows, Web Services globe. Plugin disclosure fills only while open; environment switching is momentary. Neither changes action/name/navigation ownership.

Flower's five petals meet beneath the yellow center. Navigation follows host size/state with outlined idle and filled selected petals/seams; geometry stays stable, brand/Workbench artwork unchanged. Detail masks reveal actual theme surface; forced colors use system ink. Verify live selection/disclosure/mobile editor retention and seam/icon contrast, not static SVG alone.

## Composer and layers
Expanded composer uses Floe field fill/edge as one stable writing boundary. Focus transfers among editor/toolbar/menu/thread never recolor it; internal controls retain keyboard feedback. Published Plus attachment is leftmost. Permission trigger is compact text/mode icon, no border/background/shadow even hover/open; keyboard focus underlines text.

Dedicated pages retain top editing inset and equal8px side/bottom upload/send insets. Control size sets radius; send circle stays concentric including1px border. Chat/approval/input share frame; touch targets>=44px. Companions retain panel radius/height/editor identity.

Model/permission/reasoning/More/reference/command/Goal/context/conversation layers use published material/presence. Exiting panels immediately become inert/accessibility-hidden; visual exit can reverse on reopening. Context menus keep first-frame appearance. Hover context retains content/scroll/expansion while hidden.

Model/permission lifetimes are surface-owned across toolbar/More placement. Published anchored layers constrain/measure before first paint and resolve opening side before motion; above-composer menus travel from/back to edge, flipping travel/origin together. Reduced motion suppresses travel; no product popup-motion override. Eye/ShieldCheck/Unlock consistently identify modes, including measurement copy. Moving open controls into More retains editor/focus; reactive More updates the existing anchor before focus restoration.

Background catalog availability retains configured unavailable models, disabled for admission, without setup replacement or loss of draft/search/focus. Hidden Activity pages retain transcript gutter/toolbar allocation; apply saved rail width before visible layout and never resize composer from a zero-width hidden measurement.

# Boundaries

Use restrained static depth and short functional control motion. The progress disclosure remains clickable; failure and confirmation use static attention. Existing Workbench activation, wheel, text-selection, and preview/commit contracts remain authoritative.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/styles/redeven.css` - Source.
- `redeven:internal/envapp/ui_src/src/ui/icons/ActivityBarDockIcons.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.polish.browser.test.tsx` - Hidden-page geometry, shared material, focus, responsive layouts, reversal and reduced-motion acceptance.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.permissionStability.browser.test.tsx` - First-painted popup geometry, repeated focus transfers, captured page pixels, distinct mode icons, compact bottom inset and retained thread drafts.

- `redeven:internal/envapp/ui_src/src/ui/FlowerProviderDialog.selection.browser.test.tsx` - Published checkbox faces, 44px touch targets, centered model names, stable focus/scroll, independent actions and DeepSeek search save intent.
