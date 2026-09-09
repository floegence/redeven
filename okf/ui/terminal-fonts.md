---
type: UI Contract
title: Terminal fonts across client devices
description: Resolve bundled and locally available terminal fonts without changing another client's shared preferences or terminal grid.
tags: [ui, terminal, fonts, activity, workbench, desktop]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

The Env App owns terminal font selection and document-local loading. New preferences use bundled JetBrains Mono at the existing default size of 12; existing font IDs and sizes remain intact. Each client resolves its own available font, while Floeterm owns character cells, cursor positions, and the authoritative session grid. A missing saved font falls back visibly without rewriting that preference. Font loading failure keeps the terminal usable in system monospace and offers an explicit retry.

# Contract

## One font resolver for every terminal surface

Activity, Workbench, container exec, and settings previews consume the same font catalog and resolution result. The catalog offers bundled JetBrains Mono and Iosevka, plus local Cascadia Mono, Consolas, DejaVu Sans Mono, Liberation Mono, Ubuntu Mono, SF Mono, Menlo, and Monaco. Candidate availability belongs to the client document, regardless of the remote Runtime operating system or the client's platform name.

The Env App packages `@fontsource/jetbrains-mono@5.3.0` and Iosevka WOFF2 resources. Private CSS families bind bundled options to these files rather than same-named installed fonts. Explicit `FontFace` local-source loads probe known system candidates without requesting full font enumeration or treating generic fallback metrics as proof of availability. The menu separates bundled fonts from available local fonts; an unavailable saved selection remains visible but cannot be newly selected.

The resolver deduplicates document-local loads. Resolution always reads the current requested ID, so a previous asynchronous load cannot overwrite a newer choice. Preview, actual font status, and terminal rendering use the same resolved family. A missing selected font uses JetBrains Mono if that resource loads, otherwise system monospace. Fallback and loading failures have localized status and retry actions. No fallback changes a persisted preference.

## Preferences and shared terminal geometry

Activity preferences stay on the client. Workbench retains the existing shared component font ID and size fields. A Monaco selection on macOS can therefore render with JetBrains Mono on Windows while remaining Monaco in shared state. Unknown saved IDs are retained and resolved through the same visible fallback; no protocol or storage-field migration is introduced.

Different sessions on the same Runtime retain independent grids. Multiple views of one session consume the same Floeterm Presentation and preserve its cell spans, text, cursor, and selection coordinates. A font changes only local drawing metrics; the client does not rewrap output, reinterpret Unicode width, stretch glyphs horizontally, or create another renderer. Font completion refreshes the existing renderer and input bridge geometry.

The [terminal interaction contract](workbench-terminal-interaction.md) owns controller transfer and canonical geometry. Passive observer font, viewport, and DPR changes update only local presentation and cannot send resize or activation requests. Losing control drops queued local resize proposals. Explicit activation measures the current viewport and converges through the existing atomic controller and geometry protocol. Existing clipping and navigation apply when the canonical grid does not fit the local viewport.

# Delivery boundary

Font files and menu behavior are Runtime-served Env App assets. Updating Desktop alone cannot deploy them to an unchanged remote Runtime. Validate an isolated task Runtime first; installing the font feature does not authorize upgrading or restarting other running environments. Font license text is included in the generated root third-party notice.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/terminalFonts.ts` - Client-local loading, stable candidate IDs, and side-effect-free resolution.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalFontAssets.ts` - Packaged WOFF2 faces and Unicode ranges.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSettingsDialog.tsx` - Available-font groups and resolved preview.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx` - Existing renderer refresh and controller-only resize proposals.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalFonts.test.ts` - Missing fonts, late completions, explicit retries, and independent client resolution.
- `redeven:internal/envapp/ui_src/src/ui/services/terminalFonts.browser.test.tsx` - Actual packaged face loading and glyph measurements.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.semantic.browser.test.tsx` - Observer typography and viewport changes followed by explicit activation.
- `redeven:scripts/generate_third_party_notices.mjs` - Bundled font attribution and license distribution.
