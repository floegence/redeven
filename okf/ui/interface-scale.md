---
type: UI Contract
title: Shared interface scale
description: Apply one measured desktop reading and control scale across Flower, Env App, and Desktop without shrinking content viewers or touch targets.
tags: [ui, flower, desktop, accessibility, typography]
timestamp: 2026-09-25T00:00:00Z
---
# Summary

Published Floe owns reusable typography, control dimensions, responsive input targets, settings geometry, and virtual file row measurements. Redeven maps product roles to that released scale across Flower, Files, Git, runtime settings, monitoring, services, plugins, Codespaces, and Desktop Welcome. At a browser-controlled 16px root and 100% zoom, desktop conversation text is 13px/20px, navigation is 12px/18px, and ordinary single-line rows occupy 28px including inter-row spacing. Touch and enlarged-text layouts grow naturally. No density preference, root-font reduction, transform scaling, or second theme state controls this behavior. A geometry failure is repaired at its owning component without changing permission, focus, draft, or scroll authority.

# Contract

## Type roles and boundaries

Env App and Desktop bundle Inter Variable and use the same platform fallback stack for unsupported scripts. Published Floe tokens define ordinary body and explanation text at 13px/20px, controls and navigation at 12px/18px, and secondary metadata at 11px/16px. Page titles use 16px/22px and weight 500. Ordinary text uses weight 400; selected navigation and emphasized controls use 500. Metadata does not replace readable labels. Long localized labels wrap or retain exact accessible text.

Flower applies body typography to user messages, assistant messages, tool explanations, and Markdown. Markdown H1 uses 16px/22px, H2 uses 14px/20px, and H3–H6 use 13px/20px; headings and strong text use weight 600. Paragraph spacing is 6px, list-item spacing is 2px, and heading margins are 12px above and 6px below. Commands and code use 12px/18px monospace text and retain exact copying and code semantics. Inline code uses the existing soft surface without a foreground-colored highlight.

Terminal grids, editors, file/document previews, remote applications, and chart data keep their own content-font and zoom owners. Interface scale never changes PTY geometry policy, editor preferences, document zoom, or remote pointer coordinates. Root font size, browser zoom, and system magnification remain user-controlled.

## Controls and layout density

Inline desktop actions use 28px targets; primary actions and ordinary fields use 32px. Flower's full-page header has a 40px minimum. An empty standard composer is 84px high at the reference scale; attachments, references, multiline drafts, status, and errors grow naturally instead of being clipped to that height. Shared settings use Floe's released geometry rather than copied product-side sizing.

Thread, file, and ordinary navigation rows have a 28px total pitch, with no extra per-row gap. Group separation is independent. Published Floe owns virtual file offsets and measures the same rendered row height, including fractional rem values and coarse-pointer overrides. A downstream row override must not contradict those offsets.

Thread cards place selection and the trailing slot in normal layout. The slot reserves the larger intrinsic size of its summary and independent pin/menu actions, so hover or keyboard focus does not resize the title. Attention remains marked while actions replace the summary. A long status translation moves below the title and wraps naturally; it is not a gradient over the title or a fixed right-hand reservation. A 220px rail must retain at least 100px of title width for the reference Chinese waiting state. Exact status remains in the accessible name and tooltip. Menu ownership stays bound to ThreadID across summary updates.

Coarse-pointer body text retains 14px/22px and navigation retains 13px/20px. Shared and product controls retain at least 44px targets; editable touch text is at least 16px. Natural wrapping, browser zoom, and long translations may increase row height. Actions must not overlap, clip, or leave their owning surface. Input focus changes only the existing border color through Floe's published input-focus contract.

## State and interaction

Scale is presentation only. Existing DOM and keyed approval identities remain mounted across theme changes, navigation, companion collapse, and resize. Pending commands lock only their existing action scope. Composer drafts, permissions, atomic approval batches, focus handoff, and exact command copying remain defined by their canonical Flower contracts. [Approval geometry](flower-approval-surface.md) constrains one scrolling list while retaining header and footer actions. Workbench wheel, reading selection, and floating coordinate ownership are unchanged.

# Acceptance

Density is measured on real components with published dependencies after font loading, recording source identity, loaded Floe version, font family, root size, DPR, and zoom. A diagram or HTML mockup is not product acceptance evidence. Ordinary adjacent rows have 28px pitch within 1px and a 560px list viewport shows 20 complete rows. The reference waiting title has at least 100px available and changes by at most 1px on hover. The fixed mixed-script Markdown sample at 434px and 758px must occupy no more than 90% of its frozen pre-change height.

Tests measure actual header, composer, text, and control bounds, not just one token or button. Chromium product checks and a real isolated Electron runtime cover full Flower, companion, Workbench, light/dark themes, both materials, narrow and low-height hosts, touch, retained drafts and focus, and 100%/125%/200% zoom. Approval checks include 1, 2, 10, and 50 items with final-row reachability and visible footer actions. Files/Git, settings, monitoring, and Desktop navigation retain their interaction contracts. Screenshots use matching content and dimensions; reference screenshots from another product do not establish its unmeasured CSS values.

# Evidence

- `redeven:internal/flower_ui/src/styles/flower.css` - Product typography, controls, and responsive geometry.
- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx` - Intrinsic trailing slot and retained thread identity.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.interfaceDensity.browser.test.tsx` - Frozen Markdown baselines, total row pitch, title space, header, and composer bounds.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.approvalLayout.browser.test.tsx` - Published companion and full-page approval containment.
- `redeven:internal/envapp/ui_src/src/styles/fileSurfaceRefinement.browser.test.tsx` - File rows and input focus.
- `redeven:internal/envapp/ui_src/src/ui/pages/RuntimeSettingsDesign.browser.test.tsx` - Settings scale and retained behavior.
- `redeven:desktop/scripts/check-interface-density-electron.mjs` - Real Electron reading geometry, zoom, screenshots, and retained composer.
- `redeven:desktop/scripts/check-welcome-toolbar.mjs` - Localized, enlarged, and narrow toolbar behavior.
