---
type: Product Contract
title: Managed Web Service Templates
description: Discover, define, duplicate, and deploy Environment-local host, container, and Compose service definitions.
tags: [web-services, templates, ui, containers, permissions]
timestamp: 2026-08-26T00:00:00Z
---
# Summary

- Authority: Redeven owns the Environment-local template catalog, custom definitions, revisions, duplicate lineage, and service-family identities. [Managed Web Services](managed-web-services.md) owns deployed snapshots and runtime behavior.
- Outcome: users open one right-side Service templates drawer, browse host or container cards, create custom definitions, duplicate any complete definition, and deploy into the current Environment without crowding the Web Services page.
- Invariants: built-ins are immutable; custom templates are explicit and revisioned; duplication copies definition only into a new family; container cards stay visible with a concrete disabled reason; deployed services use snapshots rather than live definitions.
- Failure boundary: malformed, incomplete, unsafe, unavailable, or conflicting definitions are rejected before lifecycle work. A template with an installed service cannot be deleted.

# Interaction contract

The Web Services header provides one **Service templates** action. It opens a large right-side drawer with search and **Host templates** / **Container templates** categories. This replaces the separate one-click-deployment strip. Managed and manually registered services remain in one responsive main grid.

Container cards remain discoverable but disabled when Docker is unavailable, the Environment is itself in a container, workspace mounting is unavailable, or Docker Compose is missing. The card explains the exact reason. DeepSeek Harness is represented by separate reviewed host and community-container cards; the latter links its source and is never described as an official DeepSeek image.

Users with read permission can inspect templates. Users with Web Service read, write, and execute permission can create, edit, duplicate, delete, or deploy custom templates. The drawer editor provides metadata, endpoint/health paths, host lifecycle scripts, guided single-container fields, and Compose YAML. User-visible copy is localized in every published locale.

# Definition and duplication contract

A definition contains display metadata, a Web endpoint, optional input parameters, and exactly one kind:

- Host: optional install, stop, and uninstall scripts; one required foreground start script; optional HTTPS archive with exact size, SHA-256, and safe relative executable path.
- Single container: one image, one container Web port, optional entrypoint, arguments, environment, user, resource bounds, and workspace, named-volume, bind, or tmpfs mounts.
- Compose: one inline document, one entry service, and one container Web port.

Host scripts are trusted executable user content and therefore require execute authority. Redeven never asks for or stores sudo credentials. Compose validation rejects builds, published ports, privileged/host namespaces, capability additions, devices, engine sockets, host env/label files, arbitrary binds, external or host-backed volumes, external named networks, scaling, profiles, includes, configs, and secrets. Only `${REDEVEN_WORKSPACE}`, project-owned named volumes, and tmpfs are allowed mount sources.

Every custom edit increments its revision. Duplicate creates an editable custom template at revision 1, records source template and revision, and assigns a new service-family identity. It copies no instance, operation, data, runtime identity, configuration, or secret. Original and duplicate can therefore be installed together. A built-in can be duplicated only when its release-locked runtime bundle or exact image digest is present; an incomplete release manifest never creates a broken copy.

An installed service retains its canonical definition and SHA-256. Editing its source affects only a future deployment. Deleting a definition is blocked while that definition owns an installed service.

# Persistence and API

Registry schema v3 adds `managed_web_service_templates` and idempotent template request records. A custom record stores metadata, deployment kind, revision, canonical JSON, SHA-256, duplicate lineage, unique service-family identity, and timestamps. Secrets are never part of template records.

Template routes are:

- `GET|POST /_redeven_proxy/api/managed-web-service-templates`
- `POST /_redeven_proxy/api/managed-web-service-templates/validate`
- `GET|PUT|DELETE /_redeven_proxy/api/managed-web-service-templates/{id}`
- `POST /_redeven_proxy/api/managed-web-service-templates/{id}/duplicate`

Reads require Web Service read permission; mutations require read, write, and execute. Bodies are strict and bounded. Create and duplicate requests use opaque request identities and fingerprints so matching retries return the original definition and conflicting reuse fails. Audit events record only bounded name, identifier, kind, revision, and action—not definitions or script contents.

# Evidence

- `redeven:internal/managedwebservice/templates.go` - Validates definitions, revisions, hashes, duplicate lineage, independent families, parameters, and availability.
- `redeven:internal/managedwebservice/types.go` - Defines public template, endpoint, host, container, Compose, and duplicate contracts.
- `redeven:internal/portforward/registry/managed.go` - Persists templates, request fingerprints, lineage, revisions, and in-use deletion protection.
- `redeven:internal/codeapp/appserver/managed_web_services.go` - Routes template APIs and applies permissions, body limits, stable errors, and bounded audit details.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Presents the drawer, categories, disabled reasons, custom editors, duplication, deployment, and unified service grid.
- `redeven:internal/managedwebservice/templates_test.go` - Covers independent duplication, immutable hash identity, and Compose host-escape rejection.
- `redeven:internal/codeapp/appserver/managed_web_services_test.go` - Covers template route authority and duplicate API behavior.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.test.tsx` - Covers discovery, container unavailability, duplication, unified cards, and uninstall interaction.
