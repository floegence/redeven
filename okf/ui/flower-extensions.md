---
type: UI Contract
title: Flower Skills and MCP
description: Manage Flower instructions and external tools from one retained two-tab surface in both product carriers.
tags: [ui, flower, skills, mcp]
timestamp: 2026-09-29T00:00:00Z
---
# Summary

Shared Flower UI owns the Skills and MCP management page. Env App and Desktop
supply the same typed, authenticated management adapter. The `Skills·MCP` entry
sits immediately below New chat in the conversation rail; runtime settings have
no separate Skills destination. Opening management preserves the unsent chat
draft, and each tab retains its filters while the surface remains mounted.
Readers can inspect skills and server catalogs but cannot mutate administrator
configuration. Failed operations keep their input and offer an explicit retry.

# Contract

## Navigation and presentation

The page has one identity header, a return-to-chat action, and two accessible
Skills/MCP tabs with arrow, Home, and End navigation. MCP loads on first visit;
hidden panels are inert. Thread selection and New chat return to conversation
without reconnecting the workspace transport. The shared Floe components own
inputs, dialogs, focus treatment, and floating placement. Dialog guidance lives
in the body, and actions reflow as whole controls at narrow widths.
The navigation glyph identifies Flower capabilities; Skills uses a wand for
reusable AI instructions and MCP uses a workflow graph for external tool
connections. These three glyphs remain distinct, and each tab's empty state
repeats its own glyph. Icon-only controls retain their accessible names.

The catalog uses a compact divided list. A desktop row keeps its name and
single-line description beside aligned metadata, browse/edit, an action menu,
and the enable switch. Default rows fit at least nine complete entries in an
850px-tall view at 960px and 1280px widths. Long names and descriptions truncate
visually while preserving their full text in titles and an accessible disclosure.
Technical paths, source detail, complete descriptions, and MCP tools expand
inside their own row. Reinstall, connection checks, and deletion use a labeled
keyboard-accessible action menu; confirmation and authorization remain unchanged.
Search/filter controls stay available while scrolling long lists. Narrow layouts
move metadata below the identity, and coarse pointers retain 44px action targets. Search is local to the visible catalog. Empty libraries
explain their next action, loading has a status, and failures remain actionable.
Both carriers resolve explicit copy for every shipped locale, including plural
counts and locale-aware check timestamps.

## Entry icons

Every skill and MCP row reserves a 32px icon beside its name without increasing
row height. A supplied icon takes precedence; unavailable, unsupported, or broken
images fall back to a name-derived monogram with a deterministic identity color.
Filtering, sorting, and reloads do not randomize that identity. Supplied theme
variants follow the product's resolved light/dark theme; an unthemed image works
in either mode. A variant for the opposite theme is not substituted blindly.
Icons are decorative, retain the adjacent accessible name, and never become
interactive targets or inline untrusted SVG markup.

Installed skills may declare `interface.icon_small` and `interface.icon_large`
in `agents/openai.yaml`. Paths are relative to the skill root; a valid small icon
is preferred, then the large icon. Reads remain inside an OS-enforced skill root,
including symlink resolution. Metadata is limited to 32 KiB and image bytes to
64 KiB. PNG, JPEG, GIF, and SVG are supported; raster dimensions are bounded to
2048px per axis. Invalid metadata does not prevent skill discovery or activation.
System skills without packaged artwork receive the same generated identity.
Catalog DTOs carry self-contained image data; model-facing skill metadata does
not carry images. MCP discovery and persistence follow
[the runtime icon contract](../ai/mcp-runtime.md#presentation-icons).

## Skills

Catalog and source metadata load once the connection is usable. Search and
scope filters preserve the complete catalog. Rows retain enablement,
effective/shadowed/dependency status, source, path, and file browsing. Reinstall
is available for GitHub imports; delete is available only for user scopes.
Bundled system skills can be browsed and toggled but not deleted.

GitHub installation requires validation of the current form. Changing any input
invalidates that validation. Create and import failures retain the form;
delete and overwrite reinstall require confirmation. Catalog refresh and
mutations are serialized so an older read cannot overwrite a successful change.
Source-metadata refresh failure is distinct from a successful mutation.

Browsing uses the catalog-authorized tree and file endpoints, renders content
as text, and exposes encoding and truncation. Failed reads can retry the same
request. Closing or changing the selected skill invalidates pending reads.
A bundled `system:<name>/SKILL.md` entry is a virtual identifier, never a host
filesystem path. Its preview reads the same embedded document used by the skill
manager. Both bundled and filesystem skills retain size, encoding, relative
path, and containment checks. Browsing requires read access and never installs
bundled files on disk.

## MCP

Add or edit a server using a remote HTTP endpoint or a local executable with one
argument per line. Advanced configuration accepts explicit JSON HTTP headers
or environment variables. Existing secret values are never filled into a form;
omission keeps them and an explicit empty object clears them. Editing a disabled
server does not enable or connect it. Saving an enabled server and explicit
connection checks discover tools before replacing the saved catalog.

Rows distinguish enabled configuration from a successful live connection; the
last check is a timestamp, not a continuously polled health claim. Search,
enabled filtering, discovered tool details, explicit connection checks, and
confirmed removal are available from the MCP tab.

# Boundaries

Catalog visibility does not grant mutation authority: readers can inspect, while
configuration changes require administrator access through the authenticated
management adapter. UI checks do not replace Runtime authorization. Removal
affects Flower's configuration, not the external service or its records. See
[the MCP runtime contract](../ai/mcp-runtime.md) for persistence, protocol,
dependency matching, and execution authorization.

# Evidence

- `internal/flower_ui/src/FlowerSurface.tsx` owns rail placement and chat return.
- `internal/flower_ui/src/extensions/FlowerExtensionsSurface.tsx` and
  `internal/flower_ui/src/extensions/extensions.css` own retained tabs and layout.
- `internal/flower_ui/host/extensionsAdapter.ts` maps typed management actions.
- `internal/flower_ui/src/extensions/ExtensionIcon.tsx` owns supplied-image
  selection, reactive themes, load-error fallback, and stable monograms.
- `internal/ai/extension_icons_test.go` checks package metadata, containment,
  bounded image normalization, and exclusion from model-facing metadata.
- `internal/envapp/ui_src/src/ui/flower/FlowerExtensions.browser.test.tsx` checks
  light/dark icons and fallback, narrow layouts, large-library density, disclosure, action menus,
  keyboard tabs, dialogs, and reader permissions.
- `internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` checks draft
  continuity and New chat navigation.
- `internal/envapp/ui_src/src/ui/pages/settings/sections/SkillsSection.test.tsx`
  and `internal/envapp/ui_src/src/ui/pages/settings/SkillFilesDialog.test.tsx`
  retain installation, retry, and stale-response coverage after the move.
