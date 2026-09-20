---
type: UI Contract
title: File icon presentation
description: Consume the released Floe file icon catalog consistently across Files and Git.
tags: [ui, files, git, upstream]
timestamp: 2026-09-20T00:00:00Z
---
# Summary

Published Floe Webapp owns file recognition rules, SVG artwork, and product
palettes. Redeven supplies filenames, directory and link metadata, and rendered
sizes. JSON, YAML, and TOML remain visually distinct; language, design, office,
and installer formats retain their reviewed identities. Unknown formats use the
upstream generic icon. An icon never grants preview, execution, or extraction
capabilities; those operations retain their existing permission and format checks.

# Contract

Files lists, grids, directory trees, pickers, and Git labels consume the same
released `FileItemIcon` contract. Exact names, filename patterns, and longest
suffixes are resolved upstream. Directory packages such as `.xcodeproj` keep
directory navigation semantics while receiving their specific artwork. Custom
icon overrides, open-folder state, symbolic links, and broken links retain the
upstream precedence rules.

The approved 156 format families and original product colors are maintained in
Floe, alongside legacy generic code aliases. Product colors stay recognizable
across shell themes; neutral paper and generic accents follow the released
light/dark icon tokens. Labels use outlined SVG paths, so system fonts cannot
change their shape. Redeven does not copy a catalog, introduce a palette, or
recolor branded icons through shell primary colors.

Explicit pixel sizes select the matching level of detail: up to 20 px uses
compact geometry; larger icons use detailed geometry. Redeven sidebar and Git
labels use 14 px, shared lists and pickers use 16 px, and grids use 40 px within
the shared 48 px icon space. The archive action uses 16 px and its dialog uses
36 px. Filenames provide accessible text; decorative SVGs remain hidden from
assistive technology.

# Boundaries

The upstream design studies are regression fixtures, not public demo pages or
production controls. Redeven consumes the public npm release without local
source wiring. Dependency ownership remains governed by
[Env App upstream web dependencies](../architecture/env-app-upstream-web-dependencies.md).
Any additional reusable format support or artwork correction must be released
upstream before a Redeven upgrade.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Published Floe release consumed by Env App.
- `redeven:desktop/package.json` - Desktop consumes the same Core and Boot release.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSidebarTree.tsx` - Compact directory artwork with preserved navigation.
- `redeven:internal/envapp/ui_src/src/ui/widgets/GitFileLabel.tsx` - Compact file identity in Git inventories.
- `redeven:internal/envapp/ui_src/src/styles/fileIconIntegration.browser.test.tsx` - Real Files grid/list, directory packages, Git labels, and product colors across shell themes.
- `redeven:internal/envapp/ui_src/src/floeWebappDependencyPolicy.test.ts` - Public release and lockfile consistency.
