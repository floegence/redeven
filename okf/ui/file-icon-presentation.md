---
type: UI Contract
title: File icon presentation
tags: [ui, files, git, flower, upstream]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floe owns filename recognition, SVG icons and palettes; Redeven supplies names, directory/link metadata and size. Formats retain reviewed distinctions and unknown files use the generic upstream icon. Icons confer no preview/execution/extraction authority, whose independent format and permission checks remain.

# Contract

Files lists, grids, directory trees, pickers, Git labels, Flower, and Ask Flower consume the same released `FileItemIcon` contract.

Labels use outlined SVG paths, so system fonts cannot change their shape.

Icons never alter canonical reference resolution, attachment admission, preview availability, removal, or focus behavior.

# Boundaries

The upstream design studies are regression fixtures, not public demo pages or production controls. Any additional reusable format support or artwork correction must be released upstream before a Redeven upgrade.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Source.
