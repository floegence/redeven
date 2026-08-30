---
type: Product Contract
title: Managed Web Service Templates
description: Discover, define, duplicate, and deploy Environment-local host, container, and Compose service definitions.
tags: [web-services, templates, ui, containers, permissions]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

- Authority: Redeven owns the Environment-local catalog, custom definitions, revisions, duplicate lineage, and service-family identities. [Managed Web Services](managed-web-services.md) owns deployed snapshots and runtime behavior.
- Outcome: one right-side drawer supports browsing, editing, duplication, and safe deployment of host and container definitions.
- Invariants: built-ins are immutable, custom definitions are revisioned, duplication creates a new family, every family has a dedicated default workspace, deployments use immutable snapshots, and required safety notices are versioned and enforced by the Runtime.
- Failure boundary: malformed, unsafe, unavailable, or conflicting definitions fail before lifecycle work; an installed definition cannot be deleted.

# Contract

## Interaction

The Web Services header provides one **Service templates** action. It opens a large right-side drawer and replaces the separate one-click-deployment strip. The catalog uses one sticky toolbar for a low-contrast category switcher with counts, search, and a permission-aware create menu. Host and container definitions are distinct categories; built-in and custom definitions are separate groups inside each category. Managed and manually registered services remain in one responsive main grid.

The catalog presents each group as one compact list: every row contains identity, one-line summary, deployment metadata, and a concise state. Installation uses only its status glyph and text; it never colors the whole row. A neutral selected-row treatment owns emphasis and opens the adjacent detail pane, which contains the full description, version, exact availability reason, primary deploy action, and labeled duplicate/edit/delete menu. This single action owner keeps interactive controls out of selectable rows and makes keyboard arrow navigation deterministic. Host and container category changes keep one stable content stage and present the next surface with one low-amplitude opacity settle from near-full visibility. Content position and size never animate, there is no blank intermediate frame, and reduced-motion preferences remove the settle. At narrow widths the detail pane moves below the list and action targets remain at least 44 px high.

A reviewed built-in uses its official upstream application mark when an attributable asset is available; other definitions fall back to a neutral host, container, or Compose kind icon. Unavailable definitions remain fully readable; installed definitions use a success state. Catalog menus and child dialogs stay above the drawer and preserve their actions. The catalog has no redundant footer or cancel action and closes through the drawer close action, Escape, or a click on the backdrop outside the drawer. Deployment and editor views keep their fixed operation footer, and the deployment view reuses the selected service identity before workspace, deployment, data, and operation information. Interactive controls use pointer or disabled cursors while text-entry fields retain the text cursor.

Built-in identity, brand, notices, runtime profile, and immutable artifacts come from one Runtime-owned definition registry; Renderer code never branches on template identifiers. Required notice revisions are enforced by the Runtime, not by a checkbox alone. Changing an acknowledgement updates only consent and action availability; notice height, following content position, and drawer scroll position remain fixed.

Each template exposes one explicit `default_workspace_path`. Redeven prepares `<writable-root>/Redeven/workspaces/managed-services/<service-family-id>`. The generated suffix has no spaces and uses the validated family identity, so variants in one family share a directory while independent Webtop families remain isolated. Deployment selects this directory instead of inferring the first filesystem root. Users may choose another writable directory, including a path with spaces, restore the recommended path, and see whether service access is isolated or broader. The whole home directory is never an accidental default.

Container definitions remain discoverable but disabled when Docker is unavailable, the Environment is itself in a container, workspace mounting is unavailable, or Docker Compose is missing. The selected detail explains the exact reason. DeepSeek Harness is represented by separate reviewed host and community-container definitions; the latter links its source and is never described as an official DeepSeek image.

Users with read permission can inspect templates. Users with Web Service read, write, and execute permission can create, edit, duplicate, delete, or deploy custom templates. The drawer editor groups metadata, Web endpoint, and runtime settings; HTTP/HTTPS is a semantic segmented choice, numeric ports are constrained controls, required fields carry a visible marker, and optional lifecycle or container-start settings stay in expandable sections. Every field supplies a concrete example or concise usage guidance. One deployment-aware validator owns client-side errors, keeps guidance geometry stable, focuses the first invalid field, and never replaces the authoritative Runtime validation. Editing updates the same mounted form instead of remounting it on each keystroke. User-visible copy is localized in every published locale.

## Definition and duplication

A definition contains display metadata, a Web endpoint, optional input parameters, and exactly one kind:

- Host: optional install, stop, and uninstall scripts; one required foreground start script; optional HTTPS archive with exact size, SHA-256, and safe relative executable path.
- Single container: one image, one container Web port, optional entrypoint, arguments, environment, user, resource bounds, and workspace, named-volume, bind, or tmpfs mounts.
- Compose: one inline document, one entry service, and one container Web port.

Host scripts are trusted executable user content and therefore require execute authority. Redeven never asks for or stores sudo credentials. The template editor validates the initial topology, immutable images, and managed Web endpoint. Installed custom instances may add typed per-service command, environment, storage, resource, network, and security overrides through [Managed Web Services](managed-web-services.md), but cannot add, remove, or rename a Compose service or replace a template-owned image. Every expanded capability is revalidated as a Runtime Resource Plan; no raw Docker or Compose CLI is accepted.

Every custom edit increments its revision. Duplicate creates an editable custom template at revision 1, records source template and revision, and assigns a new service-family identity. It copies no instance, operation, data, runtime identity, configuration, or secret. Original and duplicate can therefore be installed together. A built-in can be duplicated only when its release-locked runtime bundle or exact image digest is present; an incomplete release manifest never creates a broken copy.

The optional container `runtime_profile` defaults to the strict restricted policy. The `interactive_desktop` profile is reserved for the exact audited [LinuxServer Webtop](linuxserver-webtop.md) image digests. A duplicate may retain that profile only while it keeps one of those exact images; it is still a custom definition, loses built-in/audited identity in presentation, and remains subject to instance Resource Plan confirmation.

An installed service retains its canonical definition and SHA-256. Editing its source affects only a future deployment. Deleting a definition is blocked while that definition owns an installed service.

## Persistence and API

Registry schema v3 adds `managed_web_service_templates` and idempotent template request records. A custom record stores metadata, deployment kind, revision, canonical JSON, SHA-256, duplicate lineage, unique service-family identity, and timestamps. Secrets are never part of template records.

Template routes are:

- `GET|POST /_redeven_proxy/api/managed-web-service-templates`
- `POST /_redeven_proxy/api/managed-web-service-templates/validate`
- `GET|PUT|DELETE /_redeven_proxy/api/managed-web-service-templates/{id}`
- `POST /_redeven_proxy/api/managed-web-service-templates/{id}/duplicate`

Reads require Web Service read permission; mutations require read, write, and execute. Bodies are strict and bounded. Create and duplicate requests use opaque request identities and fingerprints so matching retries return the original definition and conflicting reuse fails. Audit events record only bounded name, identifier, kind, revision, and action—not definitions or script contents.

Catalog responses include declarative `brand_icon` and `notices`. Install requests include `accepted_notice_revisions`; service views expose the target revision/version and `update_available` only when the Runtime-owned built-in definition is newer than the installed immutable snapshot. These are compatible local API additions and require no registry migration or snapshot rewrite.

# Boundaries

Template presentation and defaults do not expand the Environment filesystem scope, grant a service access to the whole home directory, or make a custom path safe by implication. A custom workspace remains an explicit user choice and must pass the same writable-root validation as every deployment. Templates do not manage application credentials or cross-Environment scheduling. Additional listeners, host paths, devices, namespaces, sockets, and container privileges are permitted only after duplication to a custom template and the installed-service Admin-confirmed Resource Plan; built-in identity never survives that duplication.

# Evidence

- `redeven:internal/managedwebservice/templates.go` - Validates definitions, revisions, hashes, duplicate lineage, independent families, parameters, and availability.
- `redeven:internal/managedwebservice/builtin_templates.go` - Owns the single built-in definition registry, pinned Webtop artifacts, declarative brands and notices, workspace families, and reserved runtime profile.
- `redeven:internal/managedwebservice/types.go` - Defines public template, endpoint, host, container, Compose, and duplicate contracts.
- `redeven:internal/managedwebservice/manager.go` - Prepares one explicit dedicated default workspace per service family and keeps writable filesystem roots as user-selectable scope only.
- `redeven:internal/portforward/registry/managed.go` - Persists templates, request fingerprints, lineage, revisions, and in-use deletion protection.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Routes template APIs and applies permissions, body limits, stable errors, and bounded audit details.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Owns template data, directory-picker deployment choice, guided editor state, and the unified service grid.
- `redeven:internal/envapp/ui_src/src/ui/pages/ServiceTemplateCatalog.tsx` - Owns the catalog selection model, toolbar, compact grouped list, keyboard navigation, selected-template details, and action placement.
- `redeven:internal/envapp/ui_src/src/ui/icons/DeepSeekHarnessLogo.tsx` - Adapts the official MIT-licensed DeepSeek Harness fish mark for theme-aware catalog identity.
- `redeven:internal/envapp/ui_src/src/ui/pages/service-template-center.css` - Defines token-based compact rows, neutral selection, focus-compatible controls, responsive details, and reduced-motion behavior.
- `redeven:internal/envapp/ui_src/src/ui/primitives/EnvAppDrawer.tsx` - Owns drawer-local floating surfaces so catalog menus and child dialogs remain interactive above the panel.
- `redeven:internal/managedwebservice/templates_test.go` - Covers independent duplication, immutable hash identity, and Compose host-escape rejection.
- `redeven:internal/codeapp/appserver/managed_web_services_test.go` - Covers template route authority and duplicate API behavior.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.test.tsx` - Covers discovery, container unavailability, duplication, unified cards, and uninstall interaction.
- `redeven:internal/managedwebservice/webtop_test.go` - Covers Webtop identity, ordering, independent families, immutable digests, notices, runtime policy, duplication, and exact-image profile admission.
- `redeven:internal/envapp/ui_src/src/ui/pages/ServiceTemplateCatalog.test.tsx` - Covers grouping, selection, keyboard movement, counts, state presentation, permissions, search, and selected-template actions.
- `redeven:internal/envapp/ui_src/src/ui/pages/ServiceTemplateCatalog.browser.test.tsx` - Verifies list density, installed-state neutrality, selection contrast, detail alignment, narrow layouts, floating layers, and outside-click dismissal in Chromium.
