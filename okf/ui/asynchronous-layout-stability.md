---
type: UI Contract
title: Asynchronous layout stability
description: Keep controls and retained content stationary through pending work, feedback, and media decoding.
tags: [ui, accessibility, layout]
timestamp: 2026-09-28T00:00:00Z
---
# Summary

Floe owns reusable control geometry; Redeven owns the localized states and feedback placement of its product surfaces. Starting or finishing a request, copying a value, refreshing retained data, and decoding media must not push adjacent controls or content. Normal views stay compact without empty feedback rows. Blocking errors remain visible, and retained-content errors remain accessible through a compact disclosure in an existing action row. User navigation, explicit disclosure, and newly added records may change layout; asynchronous feedback must not simulate those actions.

# Contract

## Controls and feedback

Use the published Button loading slot and `icon` property. A loading indicator replaces the icon inside its existing slot. Controls which change text use the published `StableText` with every applicable localized transient label, including completion and failure. Hidden sizing labels are excluded from accessibility; the current label remains the action's visible text. Icon-only and permission indicators retain one square or dot slot across states. Button labels always remain on one line, including localized pending states. Reserve the widest transient label before work begins; visible text stays centered and wholly inside the control. The published primitive provides this default for Button and native buttons. Product action groups reflow whole controls when available width changes. Codespaces reserves complete primary progress text and adapts the secondary Open menu to card width, retaining its accessible name. Settings guidance belongs outside buttons. Bounded selection and approval labels may use ellipsis with complete accessible text and a title at enlarged text sizes; wrapping labels or growing buttons during requests is forbidden.

Feedback has one owner per independent business region. Use the released Floe `FeedbackIndicator` in an existing title, toolbar, or action row for retained-content refresh failures and update notices. It reserves one icon footprint, hides its empty trigger from sight and keyboard navigation, announces new feedback without opening or stealing focus, and reveals complete selectable, scrollable details plus recovery actions on click, touch, Enter, or Space. Escape, close, and outside click dismiss only the disclosure; the original business state remains authoritative. Resolving the last entry closes the disclosure and restores focus to the caller's stable destination if feedback owned focus. Entries have stable IDs; the component owns disclosure only, never a notification queue or error cache. Floe owns portal projection, surface bounds, overlay behavior, and local wheel/text-selection markers.

Refreshing uses the existing refresh control's loading state and `aria-busy`. Initial failures, permissions, missing prerequisites, and field validation stay directly visible in the content region with a recovery action where available. Field errors retain their input association and first-invalid-field focus. User-entered preparation flows retain actual progress and stable actions. Release candidate verification retains its bounded warning/progress lane in the explicit installation review so trust warnings remain visible. `StatusRegion` retains its explicit fixed-space contract only for these intentional progress layouts or an existing bounded footer with real guidance; never use it as an empty normal-state spacer.

Codespaces, host applications, and containers use page actions; Web services use their collection toolbar. Host component update entries do not exist on macOS. Monitoring readings and sessions have separate feedback owners in their own headings. Preview saving errors belong to the shared outer actions for page, window, and Workbench surfaces, including text, Markdown, and PDF; renderers do not repeat them. Terminal errors remain available from the session toolbar even when the optional status bar is hidden. Approval actions retain disabled conditions and separate accessible associations for directly visible unavailability reasons and compact submission errors. Settings distinguish request failures from directly visible validation; explicit retry reuses the existing autosave owner and preserves drafts. Desktop access guidance shares its existing footer. Saving indicators retain their intrinsic footprint after success feedback expires. Refreshing audit entries keeps the existing table beneath its loading curtain. Font choices reserve their sample line before font readiness; attachment cards retain a bounded progress/error lane.

Service status has a bounded column independent of action labels. A service operation uses the existing status cell as its disclosure trigger; management explanations use a keyboard- and touch-accessible tooltip in that same bounded cell. Only explicit expansion adds the detail row. Existing operation hold, failure retention, and expansion ownership remain defined by [operation progress](../architecture/managed-service-operation-progress.md). Expanded details remain user controlled. Host application preparation has an independently scrollable body and persistent action baseline.

## Media and enhancement

Unknown block image dimensions use a bounded 16:9 viewport with contain sizing. File Markdown honors authored dimensions and uses compact slots for inline images and badge rows. Failure uses the same footprint; full-size inspection remains available. Floe owns Markdown rich-media loading, failure, retry, and resolved geometry. Product Markdown reserves image and diagram space before asynchronous work and derives its table of contents synchronously from parsed headings. Long diagrams and rendering errors stay scrollable inside their reserved viewport.

## Acceptance

Normal-state acceptance measures the top of actual content, including both charts and the session table, so empty feedback lanes or leftover margins cannot pass merely by remaining stable. Module placeholders, data placeholders, and resolved content share the same starting position. Browser regression tests compare the position and size of both the changed surface and its neighbors through idle, pending, success, failure, and reset. Coverage includes macOS and non-macOS host preparation, first-load failure versus retained refresh failure, multiple entries resolving independently, full error text, retry, keyboard/touch disclosure, focus restoration, retained DOM identity/selection/scroll, projected Workbench boundaries, narrow containers, long localized labels, clipboard completion timeout, delayed diagram enhancement, and media decoding. Acceptance also verifies one rendered line per button label and measures visible text ranges against icon centers and control bounds; stationary outer rectangles alone do not prove correct alignment or readable progress. Include intermediate window widths where a multi-column card is narrower than a mobile single-column card. Source inspection and node-only rendering cannot prove layout geometry. Validation consumes published dependencies without source aliases or local overlays.

# Evidence

- `redeven:internal/envapp/ui_src/src/styles/hostApplicationAppearance.browser.test.tsx` - Standalone application controls keep localized labels on one line across Chromium, Firefox, and WebKit.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.browser.test.tsx` - Card action alignment and complete localized labels through startup and editor preparation.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RuntimeMonitorDensity.browser.test.tsx` - Compact chart and active-session table positions.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.browser.test.tsx` - Placeholder geometry includes content top coordinates.
- `redeven:internal/envapp/ui_src/src/ui/AsyncLayout.browser.test.tsx` - Real service, copy, model catalog, pagination, and saving feedback geometry.
- `redeven:internal/envapp/ui_src/src/ui/AsyncLifecycleLayout.browser.test.tsx` - Attachment lifecycle, preparation, and release verification geometry.
- `redeven:desktop/scripts/check-ssh-settings.mjs` - Real themed, localized settings geometry, keyboard flow, and save failure.
- `redeven:desktop/scripts/check-access-settings.mjs` - Security workflow continuity and stable review/footer geometry after save failure.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.approvalLayout.browser.test.tsx` - Bounded approval controls, error associations, and compact failure disclosure.
- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.layout.browser.test.tsx` - Delayed Mermaid, media decoding, and synchronous heading navigation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Shared service actions and operation presentation.
- `redeven:internal/flower_ui/src/settings/FlowerSettingsPrimitives.tsx` - Localized saving feedback and its retained footprint.
- `redeven:desktop/src/welcome/EnvironmentAccessWorkflow.tsx` - Persistent access-setting feedback within the existing security flow.
