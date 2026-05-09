# Redeven Brand Assets

This directory is the source of truth for Redeven logo and app icon artwork.

## Structure

- `svg/`: editable vector sources.
- `png/`: generated PNG exports for common app, favicon, and UI sizes.
- `ico/`: generated Windows/browser icon bundles.
- `icns/`: generated macOS app icon bundles.
- Square app icons, transparent logo marks, dark-mode logo marks, favicons, and horizontal wordmark variants live here together.

## Rules

- Edit SVG sources first.
- Keep antenna connectors as rectangular shapes that overlap both the antenna nodes and the body. Do not use rounded strokes or edge-to-edge joins for those connectors.
- Regenerate all derived assets with:

```bash
node scripts/sync_redeven_brand_assets.mjs
```

The script also updates the legacy runtime consumer paths:

- `desktop/build/icon.svg`
- `desktop/build/icon.png`
- `desktop/build/icon.icns`
- `internal/envapp/ui_src/public/favicon.svg`
- `internal/envapp/ui_src/public/logo.svg`
- `internal/envapp/ui_src/public/logo-dark.svg`
- `internal/envapp/ui_src/public/logo.png`
