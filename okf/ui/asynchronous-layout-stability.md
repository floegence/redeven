---
type: UI Contract
title: Asynchronous layout stability
description: Keep controls and retained content stationary through pending work, feedback, and media decoding.
tags: [ui, accessibility, layout]
timestamp: 2026-09-27T00:00:00Z
---
# Summary

Floe owns reusable control geometry; Redeven owns the localized states and feedback placement of its product surfaces. Starting or finishing a request, copying a value, refreshing retained data, and decoding media must not push adjacent controls or content. Errors and retry actions remain accessible in persistent feedback regions. User navigation, explicit disclosure, and newly added records may change layout; asynchronous feedback must not simulate those actions.

# Contract

## Controls and feedback

Use the published Button loading slot and `icon` property. A loading indicator replaces the icon inside its existing slot. Controls which change text use the published `StableText` with every applicable localized transient label, including completion and failure. Hidden sizing labels are excluded from accessibility; the current label remains the action's visible text. Icon-only and permission indicators retain one square or dot slot across states.

Retained collections, settings, editors, approval details, and suggestions use persistent, bounded feedback regions. Long error text remains scrollable and retry controls stay available. Workbench feedback viewports use the existing local scroll contract, including when the containing list does not overflow. Desktop access feedback shares the existing footer instead of stacking empty regions above the form. Saving indicators retain their intrinsic footprint after success feedback expires. Refreshing audit entries keeps the existing table beneath its loading curtain. Font choices reserve their sample line before font readiness; attachment cards retain a bounded progress/error lane.

Service status has a bounded column independent of action labels. A service operation uses the existing status cell as its disclosure trigger; management explanations use a keyboard- and touch-accessible tooltip in that same bounded cell. Only explicit expansion adds the detail row. Existing operation hold, failure retention, and expansion ownership remain defined by [operation progress](../architecture/managed-service-operation-progress.md). Expanded details remain user controlled. Host application preparation has an independently scrollable body and persistent action baseline.

## Media and enhancement

Unknown block image dimensions use a bounded 16:9 viewport with contain sizing. File Markdown honors authored dimensions and uses compact slots for inline images and badge rows. Failure uses the same footprint; full-size inspection remains available. Floe owns Markdown rich-media loading, failure, retry, and resolved geometry. Product Markdown reserves image and diagram space before asynchronous work and derives its table of contents synchronously from parsed headings. Long diagrams and rendering errors stay scrollable inside their reserved viewport.

## Acceptance

Browser regression tests compare the position and size of both the changed surface and its neighbors through idle, pending, success, failure, and reset. Coverage includes narrow containers, long localized labels, clipboard completion timeout, delayed diagram enhancement, and media decoding. Source inspection and node-only rendering cannot prove layout geometry. Validation consumes published dependencies without source aliases or local overlays.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/AsyncLayout.browser.test.tsx` - Real service, copy, model catalog, pagination, and saving feedback geometry.
- `redeven:internal/envapp/ui_src/src/ui/AsyncLifecycleLayout.browser.test.tsx` - Attachment lifecycle, preparation, and release verification geometry.
- `redeven:desktop/scripts/check-ssh-settings.mjs` - Real themed, localized settings geometry, keyboard flow, and save failure.
- `redeven:desktop/scripts/check-access-settings.mjs` - Security workflow continuity and stable review/footer geometry after save failure.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.approvalLayout.browser.test.tsx` - Bounded approval controls and independently scrollable failure feedback.
- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.layout.browser.test.tsx` - Delayed Mermaid, media decoding, and synchronous heading navigation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Shared service actions and operation presentation.
- `redeven:internal/flower_ui/src/settings/FlowerSettingsPrimitives.tsx` - Localized saving feedback and its retained footprint.
- `redeven:desktop/src/welcome/EnvironmentAccessWorkflow.tsx` - Persistent access-setting feedback within the existing security flow.
