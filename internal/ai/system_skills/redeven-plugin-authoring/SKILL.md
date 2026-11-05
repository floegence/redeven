---
name: redeven-plugin-authoring
description: Create, develop, test, or package ReDevPlugin application plugins for Redeven, including Web surfaces, private resources, controlled connections, and WASM Workers. Use for application plugin authoring, not Flower Agent Plugins or MCP server configuration.
---

# ReDevPlugin Authoring

Use the released ReDevPlugin tools for the platform used by this Redeven build:
**{{REDEVPLUGIN_PLATFORM_VERSION}}**. Redeven supplies the product placement and
review flow; ReDevPlugin owns package validation, generated bindings, preview,
permissions, sandboxing, execution, and runtime preparation.

## Dedicated Plugin Center drafts

In a Plugin Center creation conversation, call `plugin_author.status` first.
It resolves the authenticated draft and managed source directory; never invent a
project ID, capture another conversation, or initialize outside that directory.
For a new empty source, use `plugin_author.initialize` with the selected template.
Use normal approved file and terminal tools to edit source and install required
dependencies. Use `plugin_author.build` for explicit pipeline execution; it runs
project commands under the same approval boundary. `plugin_author.capture` only
validates an already-built output and is not evidence that business tests ran.

The workspace owns the real preview. Keep the dedicated conversation and source
through iterations. Apply newer artifacts through the workspace, and inspect and
install the exact current preview there. Do not start a parallel dev server,
install through a shell, grant permissions, or declare a fixture a real test.
When the user selects Create directly, implement from existing requirements and
the submitted message; ask only for a decision required to proceed.

## Standalone projects outside Plugin Center

Inspect the selected project's rules and existing manifest and
`redevplugin.project.json` before changing it. Keep existing plugin identity,
data contracts, and user code. Choose the simplest template that meets the task:
`web` for a Web surface, `data` for a persistent editor, `files` for binary
imports, `monitor` for a controlled WebSocket dashboard, or `worker` for WASM
backend work. Private KV, SQLite, files, and settings do not require a forwarding
Worker. Product business capabilities still need a released host adapter.

Use a CLI whose `redevplugin version` output matches the platform version above.
When it is missing or mismatched, install the exact published module:

```sh
GOWORK=off go install github.com/floegence/redevplugin/v3/cmd/redevplugin@v{{REDEVPLUGIN_PLATFORM_VERSION}}
redevplugin version
redevplugin init dev.example.notes "Notes" notes
cd notes
npm install
redevplugin dev .
```

The initialization commands are an example for a new project; do not run init
over an existing project. Invoke the installed binary by its actual path if
GOBIN or GOPATH/bin is not on PATH. Generated projects require Node 26; Worker
projects also need Rust 1.98.0 and the wasm32-unknown-unknown target. Dev checks
readiness before starting and reports missing dependencies. Use
`redevplugin doctor .` for environment diagnostics without running author commands;
`redevplugin check .` runs configured typechecking, build, business tests, and
package validation.

## Standalone CLI preview

These CLI steps apply only outside a dedicated Plugin Center draft. Inside a
draft, the workspace owns preview and installation; never launch another dev server.

Open the local preview URL printed by dev. Keep one development process for the
chosen project and use its output to diagnose failures. For persistent data and
explicit candidate review, run:

```sh
redevplugin dev . --state ../notes-development --manual
```

An explicit state directory outside the source project preserves application data and grants across restarts;
each restart creates fresh session authority. Manual mode stages successful builds
until Apply update is confirmed, so the active frame and unsaved drafts remain
available while editing. Save drafts before applying or reloading: the replacement
frame loads saved data, not arbitrary prior DOM state. Failed builds retain the
last valid preview. Project-configuration changes require a restart.

After changing declared actions, regenerate the configured binding directory with
`redevplugin generate manifest.json <bindings-directory>`. Dev regenerates an
explicit tool-owned bindings directory; check and test detect drift. Read the
actual project configuration instead of assuming every project uses `generated`.
Do not replace generated clients with a second bridge or hand-coded broker API.

Use the preview's resource, connection, action, execution, and diagnostics panels.
Configurable connectors require review of the exact destination and explicit
approval; local endpoints also require the loopback option and normal network
grants. A preview does not authorize installation or production resource access.
Inspect an uncertain operation instead of blindly replaying it. Reset development
data is destructive and belongs to the preview's explicit confirmation flow.

## Workers when needed

Prepare a development runtime from verified published sources:

```sh
redevplugin runtime prepare ../notes-runtime
```

Preparation requires Node 26, authenticated GitHub CLI, Rustup, and tar. Read the
returned runtime path, runtime_sha256, and evidence path; pass that exact verified
pair to dev or test. Do not establish trust by hashing an arbitrary executable.
An existing output directory is rejected; a new output can reuse the verified
build cache. Development evidence does not replace product runtime signing,
SBOM, or production packaging.

## Verify and deliver

Run `redevplugin test .` and inspect its stage report. Business/package success
alone does not prove real browser rendering, resource authorization, or WASM
execution. Exercise the plugin's actual user journey in the preview, including
relevant persistence, conflict, denial, cancellation, and failed-build behavior.
For Worker execution, test the declared method with the verified runtime pair
and the command's surface, method, and params options. Do not invent permission
grants or treat a fixture as real-runtime evidence.

Package the validated output directory from `redevplugin.project.json` with
`redevplugin package <output-directory> <destination.redevplugin>`, then validate
the resulting package. Keep source and final deliverables at the user-selected
project or destination and report the checks that actually ran. Installation in
Redeven goes through Plugin Center's inspect, review, and confirm flow. Plugin
installation, execution permissions, signing trust, and automatic updates remain
separate facts; creating a plugin grants none of them implicitly.
