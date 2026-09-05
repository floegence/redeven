---
type: Runtime Contract
title: Managed Web Services
description: Operate generic Host, Container, and Compose services from the current verified external template definitions.
tags: [architecture, web-services, runtime, containers, security]
timestamp: 2026-09-04T00:00:00Z
---
# Summary

- Authority: Redeven owns instance state, Runtime digests, bindings, resources, operations, and forwards; verified templates define behavior and the released catalog defines built-ins and assets.
- Outcome: every valid template uses one generic install, lifecycle, recovery, and uninstall engine without template-specific branches.
- Invariants: one Registry state authority, exact external-resource identity, explicit recovery actions, and Renderer use of backend capabilities.
- Failure boundary: invalid catalogs, bindings, resources, releases, permissions, and health checks fail closed without adopting or mutating unknown resources.

# Contract

## Catalog and installation

Redeven loads the released `github.com/floegence/redeven-service-templates` bundle before opening the Registry or starting the Manager. Bundle schema, module version, manifest, SHA-256, template documents, localization coverage, icons, platforms, HTTPS sources, and exact OCI artifacts are strictly validated. Startup stops on any mismatch; there is no built-in fallback catalog.

Install accepts one exact template ID and persists that ID, instance configuration, the selected release identity, RuntimeBinding v2, workspace ownership, the applied Runtime digest, and the first operation in the Registry transaction. It does not copy a template revision or snapshot into the service. With no version choice it installs the template's recommended/default release; an explicit compatible source candidate overrides that default, and later template edits never replace the installed release identity. A default workspace path is only a recommendation: Catalog and template reads are filesystem-free. Manager validates the selected path, persists the service, and creates a missing leaf during the install environment-check stage. The resulting ownership is `redeven_created` only when that worker created the leaf; existing or raced-in directories are `user_selected`. Install retry may recreate a missing saved directory but never changes established ownership.

One resolver combines the current verified TemplateSpec, persisted instance configuration and secrets, selected release, RuntimeBinding, and workspace parameters before every install, start, restart, update, reconfigure, recovery, verification, settings, and Open decision. That resolved specification is the only executable behavior source. Host, Container, and Compose drivers do not inspect a template ID, family, package name, image name, display name, or asset to select behavior. A canonical Runtime digest identifies the behavior actually applied to the managed resource. Template name, description, revision, and other metadata-only edits do not change that digest; an executable template change does. Runtime-changing custom-template edits wait until every referencing instance has no active operation, while metadata-only edits remain independent. A verified journal target retains the digest of the Runtime it actually built even when the template changes before database commit, and the next explicit lifecycle or Open action reconciles the resulting stale digest through the ordinary Runtime path.

Host supports a verified HTTPS software archive or a declarative exact npm release. npm installation uses a Redeven-managed Node Runtime, an exact `package@version`, no package lock, temporary 0600 Registry configuration, explicit lifecycle-script execution, and post-install identity checks. The start script remains the only launch entry and receives the verified executable through `REDEVEN_INSTALL_EXECUTABLE`. A Host may declare `startup_output_url` with one exact line prefix instead of using the static endpoint path for Open. Runtime accepts only one prefixed URL whose scheme matches the endpoint and whose host and port match that service's loopback listener. Its path and query are stored in a mode-0600 private file bound to service, applied Runtime digest, and v2 process identity; it is never Registry, log, operation-output, diagnostic, or audit data. Missing or invalid output fails startup and stops the process. Stop, restart, update, exit, and uninstall invalidate the private entry. The Runtime-derived lifecycle plan is read-only and uses safe placeholders rather than private paths, credentials, or source URL queries.

Container pulls an exact current-platform digest and validates the standard `redeven-mws-*` name, container ID, service labels, image reference, digest, mounts, ports, and runtime configuration. `managed_web_service_resources` is the sole durable authority for volumes and other owned engine resources. Compose similarly validates its deterministic project, private configuration, service membership, images, and entry forward. No file marker, historical resource importer, alternate name, or product-specific driver exists.

## Runtime identity and operations

Every service has one canonical RuntimeBinding v2 plus SHA-256:

- Host records only standard relative installation, family-data, and log locations plus the v2 process-identity contract.
- Container records the one standard managed container name and exact resource IDs.
- Compose records the deterministic project and managed configuration directory.

All lifecycle paths verify the binding before touching a runtime. Runtime-mutating operations also verify that the saved workspace is the same regular directory inside a currently writable Environment root before any driver side effect, and every driver start repeats that verification at the launch boundary. A missing workspace fails with `WORKSPACE_MISSING`; ordinary start, restart, update, rollback, and recovery never create it implicitly. An explicit retry of a failed start or restart may recreate a missing path after the same scope and identity checks, then continues through the one normal lifecycle path. This repair applies to both ownership values and preserves the saved ownership, so it cannot expand later deletion authority. Existing files, symlinks, identity changes, and paths outside writable scope remain unchanged and fail closed. Stop, uninstall, and cleanup remain available without the workspace.

Host process adoption requires the complete v2 launch fingerprint; PID or command-text similarity is never ownership. Container and Compose require complete persisted identity. Update and reconfigure stage a target, commit the new binding only after health succeeds, and restore the old binding on failure. Uninstall removes only resources explicitly owned by the current binding; retained data and the workspace remain outside implicit cleanup. One explicit delete-data choice removes the managed data and the saved workspace directory, regardless of whether Redeven created or the user selected that directory. Manager performs the scoped, non-following workspace deletion after Runtime/data cleanup and before the Registry transaction removes the service. A failed workspace or post-runtime cleanup remains retryable without repeating completed driver deletion; protected roots, symlink identity changes, and overlapping service workspaces fail closed.

One operation record and event stream own progress through the [Managed Service operation progress](managed-service-operation-progress.md) contract. Structured failures expose localized safe diagnostics and stable codes without raw commands, engine output, secrets, stacks, or private paths.

## Manual recovery

`ServiceView.actions` is the only action-capability authority. For `start`, `stop`, `restart`, and `retry`, the backend returns availability plus a reason code; Renderer neither maps error codes nor inspects failed actions to invent recovery.

The generic retry endpoint resolves the latest eligible failed operation:

- install becomes `retry_install`;
- start, stop, restart, and uninstall replay the same action;
- update requires the user to select a release again;
- reconfigure requires a new preflight and confirmation.

Every retry records its real action and `retry_of_operation_id`. A current failure is never executed automatically at Runtime startup. A clean service whose desired state is running may resume after normal Runtime restart; a service with a current error waits for an explicit user action. Successful work clears only the current error, while terminal history remains auditable.

## Persistence baseline

`portforward_registry_v2` schema version 1 is the user-approved one-time pre-release baseline for current-template resolution. A service row stores template ID, configuration, selected release, RuntimeBinding, workspace ownership, desired and observed state, protected Forward identity, managed Runtime identity, applied Runtime digest, artifact reference, and failure state; it stores no template revision, template snapshot, duplicated deployment, or service-family projection. The baseline also contains exact current TemplateSpec v5, release-check v2, operation-progress v2, resource, operation, and retry-lineage state.

Every `portforward_registry_v1` version and any other discarded kind, future version, or exact structure drift is rejected read-only and remains byte-for-byte unchanged. Once v2 version 1 is merged and released or distributed, the kind is permanent: every persistent change must append a contiguous transactional migration that preserves user state and verifies the exact source and target shape. Another reset is not permitted.

# Boundaries

Redeven does not contain built-in service names, descriptions, notices, icons, template IDs, package identities, image identities, product-specific commands, or legacy runtime adoption rules. It does not automatically upgrade discovered releases, infer ownership from live engine state, move application data, or manage credentials beyond the typed template parameter contract.

# Evidence

- `redeven:internal/managedwebservice/builtin_templates.go` - Loads and strictly maps the released external catalog.
- `redeven:internal/managedwebservice/runtime_resolution.go` - Resolves the current template with persisted instance state and computes the applied Runtime digest.
- `redeven:internal/managedwebservice/runtime_binding.go` - Defines and validates the sole current RuntimeBinding format.
- `redeven:internal/managedwebservice/manager.go` - Serializes lifecycle operations, capabilities, manual retry, recovery, and failure state.
- `redeven:internal/managedwebservice/custom_host.go` - Owns generic Host execution and v2 process identity.
- `redeven:internal/managedwebservice/host_runtime_output.go` - Captures redacted Host output and validates process-bound private opening paths.
- `redeven:internal/managedwebservice/custom_container.go` - Owns exact current container identity and generic resource validation.
- `redeven:internal/managedwebservice/update.go` - Commits or restores release and binding state around health validation.
- `redeven:internal/portforward/registry/schema.go` - Defines the exact `portforward_registry_v2` version-1 baseline and strict existing-file validation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Renders backend capabilities, localized catalog content, progress, and safe diagnostics.
- `redeven:scripts/check_managed_service_catalog_boundary.mjs` - Prevents service-specific catalog content from returning to Redeven runtime and Renderer source.
