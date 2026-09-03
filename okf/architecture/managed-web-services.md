---
type: Runtime Contract
title: Managed Web Services
description: Operate generic Host, Container, and Compose services from verified external template snapshots.
tags: [architecture, web-services, runtime, containers, security]
timestamp: 2026-09-02T00:00:00Z
---
# Summary

- Authority: Redeven owns installed snapshots, Runtime bindings, resource identities, operations, and protected forwards; the released template catalog owns every built-in service definition and presentation asset.
- Outcome: any valid template follows one install, start, stop, restart, update, reconfigure, retry, and uninstall engine without template-specific branches.
- Invariants: Runtime state has one Registry authority, external resources are accepted only by exact identity, failures require an explicit user action, and Renderer consumes backend capabilities rather than inferring recovery.
- Failure boundary: invalid catalogs, bindings, resources, releases, permissions, or health checks fail closed without adopting or mutating unknown resources.

# Contract

## Catalog and installation

Redeven loads the released `github.com/floegence/redeven-service-templates` bundle before opening the Registry or starting the Manager. Bundle schema, module version, manifest, SHA-256, template documents, localization coverage, icons, platforms, HTTPS sources, and exact OCI artifacts are strictly validated. Startup stops on any mismatch; there is no built-in fallback catalog.

Install accepts one exact template ID and persists its immutable TemplateSpec v4 snapshot, digest, localized identity, configuration, selected release identity, RuntimeBinding v1, workspace ownership, and first operation in the Registry transaction. With no version choice it installs the template's recommended/default release; an explicit compatible source candidate overrides that default. A default workspace path is only a recommendation: Catalog and template reads are filesystem-free. Manager validates the selected path, persists the service, and creates a missing leaf exactly once during the install environment-check stage. The resulting ownership is `redeven_created` only when that worker created the leaf; existing or raced-in directories are `user_selected`. Host, Container, and Compose drivers consume the typed snapshot only. They do not inspect a template ID, family, package name, image name, display name, or asset to select behavior.

Host supports a verified HTTPS software archive or a declarative exact npm release. npm installation uses a Redeven-managed Node Runtime, an exact `package@version`, no package lock, temporary 0600 Registry configuration, explicit lifecycle-script execution, and post-install identity checks. The start script remains the only launch entry and receives the verified executable through `REDEVEN_INSTALL_EXECUTABLE`. The Runtime-derived lifecycle plan is read-only and uses safe placeholders rather than private paths, credentials, or source URL queries.

Container pulls an exact current-platform digest and validates the standard `redeven-mws-*` name, container ID, service labels, image reference, digest, mounts, ports, and runtime configuration. `managed_web_service_resources` is the sole durable authority for volumes and other owned engine resources. Compose similarly validates its deterministic project, private configuration, service membership, images, and entry forward. No file marker, historical resource importer, alternate name, or product-specific driver exists.

## Runtime identity and operations

Every service has one canonical RuntimeBinding v1 plus SHA-256:

- Host records only standard relative installation, family-data, and log locations plus the v2 process-identity contract.
- Container records the one standard managed container name and exact resource IDs.
- Compose records the deterministic project and managed configuration directory.

All lifecycle paths verify the binding before touching a runtime. Host process adoption requires the complete v2 launch fingerprint; PID or command-text similarity is never ownership. Container and Compose require complete persisted identity. Update and reconfigure stage a target, commit the new binding only after health succeeds, and restore the old binding on failure. Uninstall removes only resources explicitly owned by the current binding; user workspaces and retained data remain outside implicit cleanup. With an explicit delete-data request, a Redeven-created dedicated workspace is deleted automatically. A user-selected workspace is deleted only when the user separately opts in. Manager performs the scoped, non-following deletion after Runtime/data cleanup and before the Registry transaction removes the service. A failed workspace or post-runtime cleanup remains retryable without repeating completed driver deletion; protected roots, symlink identity changes, and overlapping service workspaces fail closed.

One operation record and event stream own progress. The service-row disclosure is the only details entry and shows ordered stages, exact artifact identity, trustworthy byte and layer progress, smoothed rate, and elapsed time. Unknown totals stay indeterminate. Ordinary progress persists and publishes at most every 500 milliseconds; stage and terminal changes publish immediately after persistence. Structured failures expose localized safe diagnostics and stable codes without raw commands, engine output, secrets, stacks, or private paths.

## Manual recovery

`ServiceView.actions` is the only action-capability authority. For `start`, `stop`, `restart`, and `retry`, the backend returns availability plus a reason code; Renderer neither maps error codes nor inspects failed actions to invent recovery.

The generic retry endpoint resolves the latest eligible failed operation:

- install becomes `retry_install`;
- start, stop, restart, and uninstall replay the same action;
- update requires the user to select a release again;
- reconfigure requires a new preflight and confirmation.

Every retry records its real action and `retry_of_operation_id`. A current failure is never executed automatically at Runtime startup. A clean service whose desired state is running may resume after normal Runtime restart; a service with a current error waits for an explicit user action. Successful work clears only the current error, while terminal history remains auditable.

## Persistence baseline

`portforward_registry_v1` schema version 3 is the current lineage. Fresh initialization retains the reviewed `0 -> 1` baseline and then applies contiguous `1 -> 2` and `2 -> 3` migrations. Version 2 migrates TemplateSpec v3 documents to v4, removes duplicated template and service `version` columns, and adds digest-verified release-check summaries. Version 3 adds non-null workspace ownership and the operation's delete-workspace intent while preserving exact ReleaseIdentity, configuration, secrets, resources, operations, RuntimeBinding, forwards, and user data. Existing services migrate conservatively to `user_selected`; no existing directory is claimed or removed.

An existing file with another kind, a future version, or exact structure drift is rejected read-only and remains byte-for-byte unchanged. After this pre-release baseline, every persistent change must retain the kind and append a contiguous transactional migration; another reset is not permitted.

# Boundaries

Redeven does not contain built-in service names, descriptions, notices, icons, template IDs, package identities, image identities, product-specific commands, or legacy runtime adoption rules. It does not automatically upgrade discovered releases, infer ownership from live engine state, move application data, or manage credentials beyond the typed template parameter contract.

# Evidence

- `redeven:internal/managedwebservice/builtin_templates.go` - Loads and strictly maps the released external catalog.
- `redeven:internal/managedwebservice/runtime_binding.go` - Defines and validates the sole current RuntimeBinding format.
- `redeven:internal/managedwebservice/manager.go` - Serializes lifecycle operations, capabilities, manual retry, recovery, and failure state.
- `redeven:internal/managedwebservice/custom_host.go` - Owns generic Host execution and v2 process identity.
- `redeven:internal/managedwebservice/custom_container.go` - Owns exact current container identity and generic resource validation.
- `redeven:internal/managedwebservice/update.go` - Commits or restores release and binding state around health validation.
- `redeven:internal/portforward/registry/schema.go` - Defines exact v1-v3 shapes plus the atomic v1-to-v2 and v2-to-v3 migrations.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Renders backend capabilities, localized catalog content, progress, and safe diagnostics.
- `redeven:scripts/check_managed_service_catalog_boundary.mjs` - Prevents service-specific catalog content from returning to Redeven runtime and Renderer source.
