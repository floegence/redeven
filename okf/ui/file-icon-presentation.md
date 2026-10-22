---
type: UI Contract
title: File icon presentation
description: Consume the released Floe file icon catalog consistently across Files, Git, Flower, and Ask Flower.
tags: [ui, files, git, flower, upstream]
timestamp: 2026-10-12T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe Webapp owns file recognition rules, SVG artwork, and product
palettes. Redeven supplies filenames, directory and link metadata, and rendered
sizes. JSON, YAML, and TOML remain visually distinct; language, design, office,
and installer formats retain their reviewed identities. Unknown formats use the
upstream generic icon. An icon never grants preview, execution, or extraction
capabilities; those operations retain their existing permission and format checks.

# Contract

Files lists, grids, directory trees, pickers, Git labels, Flower, and Ask Flower consume the same released `FileItemIcon` contract.

Labels use outlined SVG paths, so system fonts cannot change their shape.

Icons never alter canonical reference resolution, attachment admission, preview availability, removal, or focus behavior.

# Boundaries

The upstream design studies are regression fixtures, not public demo pages or production controls. Any additional reusable format support or artwork correction must be released upstream before a Redeven upgrade.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Published Floe release consumed by Env App.

- `redeven:desktop/package.json` - Desktop consumes the same Core and Boot release.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSidebarTree.tsx` - Compact directory artwork with preserved navigation.
