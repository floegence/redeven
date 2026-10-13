---
type: UI Contract
title: Flower companion composer and motion
description: Preserve one native editor while placing tools below text and dissolving detail into the compact companion entry.
tags: [ui, flower, companion, composer, motion]
timestamp: 2026-10-13T05:15:00Z
---
# Summary

Redeven owns the Flower companion content presentation; released Floe owns its shell geometry and motion phases. One native composer retains its draft, selection, focus and IME through every presentation change. Expanded text sits above a bottom toolbar whose left side stays empty; permission, model and reasoning remain in More during loading and model failures. Guidance and recovery actions sit above the editor rather than competing with toolbar space. Closing detail dissolves before the compact layout appears, and reversal follows the current shell phase without remounting an editor or adding lifecycle timers. Specialized decisions retain their controls. [Flower Activity companion](flower-activity-companion.md) owns placement, dismissal, focus handoffs and read acknowledgement.

# Contract

## Retained editor and explicit entry

The ordinary Flower composer textarea is literally the collapsed floating field and the expanded detail composer. Expansion and collapse do not clone, replace, crossfade, or copy its value, selection, focus, or composition state. User focus, clicking, typing, or starting IME composition requests expansion when collapsed or disengaging during close, while that same node remains mounted. Retained expanded layout does not suppress this explicit reversal intent. Escape focus restoration is explicitly non-activating; a later click reopens even if the editor remains focused. The old quick-entry input, quick draft, IME bridge, composer handoff request, and manual frame resolver do not exist.

Collapsed presentation hides and disengages the header, transcript, thread rail, status lanes, and supporting composer controls. Every pending input request, approval, or Computer takeover uses one compact action, including plain writing, secret questions, and select-or-write questions with a custom answer. Answer mode and progress never change this entry into an editor. Decision controls remain mounted, hidden, and inert while collapsed; existing editors retain their nodes, drafts, and selection. Ordinary questions show the public summary, then the active question, then localized action copy. Secret, approval, and Computer actions use generic localized copy; answer values and another thread's status never become their labels. Read-only or temporarily unavailable editors retain an enabled inspection entry. [Flower companion presence](flower-companion-presence.md) owns the complete entry precedence.

The content button and unused composer space share one activation route and exact target thread. The title exclusively opens the conversation switcher with expansion. Native editor selection and IME behavior remain intact; opening never submits an answer, selects an option, starts work, or stops work. Pointer activation of an entry button places focus in the retained reading surface without focusing a text field. Keyboard question activation focuses the current custom/text editor, selected choice, first available choice, or question region in that order. Approval and Computer entry activation focus their explanation region.

When the collapsed companion has no selected thread, its conversation switcher remains as a compact Flower icon-only button. It omits the fallback `Ask Flower` title, chevron, and title-width reservation so the ordinary composer owns the released space. The icon keeps the localized conversation-switcher accessible name and tooltip; activation opens the companion and its existing thread switcher, including new-conversation entry. Once a thread is selected, the compact title and chevron return. Pending input, approval, and active-work summary precedence remains unchanged.

## Editor layout and growth

Expanded companion presentation keeps one stable ordinary chat composer. Its textarea grows from one through five visual lines using measured line height and `scrollHeight`, then keeps the five-line height and scrolls internally from the sixth line. Soft wrapping, IME completion, connection-local updates, width changes, font readiness, clearing, and expansion all schedule the same coalesced measurement. Collapsed presentation suspends measurement and restores the single-line shell geometry. The textarea occupies a full-width upper row. Attachment and More form an adjacent zero-gap pair of 44 CSS pixel targets before Send in a lower toolbar anchored to the composer bottom. Short input must not leave unused space below that toolbar; multiline growth moves the toolbar down without changing editor identity. Permission, model and reasoning, and read-only metadata use the upward-opening More panel in every ordinary companion chat state, including setup, source failure, warmup and detail loading. The left toolbar area stays empty. Approval and user-input composers retain their specialized decision controls. The dedicated Flower page uses the same one-to-five-line composer behavior with measured inline-control overflow.

Setup guidance, model-source recovery, billing guidance and handler failures have one notice lane above the editor, outside the measured controls viewport. A companion source failure provides its specific recovery row without repeating generic setup guidance. Measured zero width means no available inline-control space; only a not-yet-measured viewport may retain provisional inline controls. Removing controls must never restore all controls merely because the measured viewport reached zero. The companion does not display working-directory browsing or selection, under the [working-directory navigation contract](flower-working-directory-navigation.md).

An empty expanded companion keeps the Flower identity, concise description, and composer guidance, but does not mount starter task suggestions. The bounded detail surface prioritizes transcript and composer space and does not reserve blank placeholders for the omitted controls. The dedicated Flower page retains the complete starter suggestion grid and its prompt-to-composer actions.

## Motion and surface treatment

Opening animates the width and height of one shell together, growing upward and outward from the compact entry while preserving its bottom edge and continuous border, background, and clipping boundary. The bottom edge is clamped only if the anchor extends beyond the safe visual viewport. Opening and closing use the same reversible 360ms geometry curve. Closing keeps valid geometry through every transition frame, including a rapid reversal. It never clears fixed coordinates during exit, never flashes at the viewport origin, and never changes Activity body height. Reduced motion applies the same final state without geometry or glyph animation.

The published `BottomBarCompanion` owns the collapsed surface's only visible outline, background, radius, and clipping. The retained Flower composer has no border, background, radius, shadow, or backdrop filter while collapsed, including focused, loading, pending-action, and attachment-drag states. Expanded content remains mounted during the closing geometry transition; a reversible 120ms opacity transition fades it out before shrinking geometry can clip the header into the compact entry. The compact layout returns invisibly when the shell reaches its anchor, then fades in through the same transition. Rapid reopening reverses from the current opacity without timers or another content owner; reduced motion keeps content opaque and disables the dissolve. Expanded and transitioning companion shells use one opaque published popover surface and neutral floating shadow. Their editor retains one input boundary without an additional shadow. The brand icon and collapsed running, waiting, completion, and failure states have no breathing, sweeping light, or halo; state text and local progress symbols remain visible. Non-collapsed editors own their ordinary composer decoration independently. Flower's custom composer uses its own structural styles rather than borrowing the upstream `ChatInput` skin. Visual regression fixtures must include the production `flower-surface` class and verify computed styles; source-rule presence alone cannot prove CSS cascade behavior.

# Boundaries

This concept owns content presentation only. Floe owns geometry and phase completion; the Activity companion contract owns placement, dismissal and reads. The dissolve adds no focus manager, editor copy, timer or lifecycle state. [Flower companion presence](flower-companion-presence.md) remains the owner of status precedence and workspace observation.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Retained editor and explicit entry decisions.
- `redeven:internal/flower_ui/src/styles/flower.css` - Compact content isolation and expanded text/toolbar layout.
- `redeven:internal/envapp/ui_src/src/ui/activity-flower-shell.css` - Phase-driven content opacity and theme treatment.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.companionEntry.browser.test.tsx` - Published shell geometry, closing opacity, reversal, tool alignment and retained drafts.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.companionAppearance.browser.test.tsx` - Production outline, editor identity, selection and composition.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.companionComposer.browser.test.tsx` - Model-failure layout stability, empty toolbar, More permission editing, hidden directory and retained execution context.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerAutosizeController.ts` - Coalesced one-to-five-line measurement, suspension and resize ownership.
