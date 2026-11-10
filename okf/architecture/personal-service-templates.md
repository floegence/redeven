---
type: Runtime Contract
title: Personal service templates and pinned source derivation
tags: [architecture, templates, managed-services, persistence]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Personal service templates combine an independently editable product definition with verified immutable upstream files. They preserve source provenance without mutating the source library or existing instances. Copies retain verified source provenance while keeping their own identity and editable definition.

# Contract

Redeven owns personal definitions and their immutable base references; published upstream readers, formats and runtime policies remain authoritative. No new GitHub repository or format fork is required. Official/community detail actions expose **Create my template**. A remote selection passes through the same owner-scoped pinned source review, then naming, creation, and immediate editing in My templates. Accepted Git sources and personal templates support the same copy action. Cancellation releases the preview; environment changes fence the response without sending cleanup to another environment. Copies have independent template/family IDs and workspaces; they never copy instances, secrets or application data.

Registry migration v7-to-v8 adds a foreign-keyed personal-template base reference. Definition, retained source version, reference and request receipt commit atomically. Replay reads the receipt even after the review expires. Original files, executable modes, notices/translations, icons, access defaults and runtime-file identity survive source-library update/deletion, copying a copy and restart. User names/descriptions override original display translations. The custom spec remains editable while immutable auxiliary source files are verified on every load; external tampering fails closed. Garbage collection protects personal references until their final owner is deleted.

Interactive-desktop copies retain the exact audited runtime definition and capability. Only name/description are editable in their template editor, with a visible explanation and disabled runtime fields; instance settings remain the existing customization path. Edited images/scripts cannot inherit the reserved capability. Other Host, Container and Compose copies preserve undisplayed spec fields during form edits, including startup rules, multi-argument entrypoints and resource identities. Plain script Host templates do not require npm fields.

# Boundaries

Personal definitions remain independent of source libraries and existing instances. Copying preserves verified immutable files and provenance, never instance secrets or application data; published upstream formats and runtime policies remain authoritative.

# Evidence

Acceptance: `TestPersonalCopyNativeLifecycle` independently exercises Host/Container/Compose review, copy, edit, reload, preflight, install, stop/edit/start, health, Chromium open/reload/reopen and uninstall with task-owned resources. Set `REDEVEN_TEMPLATE_MARKET_NATIVE_TEST=1`, `REDEVEN_TEMPLATE_MARKET_IMAGE_DIGEST` to a verified BusyBox 1.36.1 digest and optionally `REDEVEN_PERSONAL_TEMPLATE_EVIDENCE` to an existing output directory. For all real official applications, add `REDEVEN_OFFICIAL_TEMPLATE_PERSONAL=1` to the [official native qualification](managed-web-service-templates.md#evidence); copied desktop runtimes still require painted desktop evidence.

- `redeven:internal/managedwebservice/template_personal_copy_test.go` - personal ownership, pinned files, copy chains, isolation, replay and reserved runtime boundaries.
- `redeven:internal/portforward/registry/template_bases_test.go` - migration and atomic personal-reference persistence.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.browser.test.tsx` - responsive source review, naming, editing, saving and reopening for all three deployments.
