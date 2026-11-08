---
type: Architecture Contract
title: Container engine service management
tags: [architecture, containers, docker, podman, host-control]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

One ContainerServiceController owns Docker/Podman discovery, lifecycle, configuration, preflight identity and reconciliation. Known management/health faults retain ID/implementation/config sources/actions. Missing CLI/permission/timeout/unknown is not stopped.

# Contract

## Identity/execution
Discover engines independently,one service each,no inactive-context scan/fallback. Share two-second command budget per engine; health reuses selected endpoint. Resource readiness separately bounded. Desktop requires selected desktop-linux/desktop-windows or exact endpoint alias; installed plugin proves no ownership. Use docker desktop version --format json,not slow status. Resolve Podman Machine before health.

Start needs stopped;Stop/Restart running;save-and-restart needs known state before write,plain save remains.

Lifecycle shares two minutes across steps vs ten-second queries/two-second discovery,parent deadline/cancel honored. macOS Start uses /usr/bin/open -g -b com.docker.docker then bounded poll;Restart stops first. Other platforms/Stop use official CLI. LaunchServices allowlists identity/home/PATH/temp/shell/locale/timezone/proxy/certificates,excluding Redeven metadata,Electron/Node controls,CLI overrides,secrets. Explicit empty env stays empty;CLI/probes unchanged. Launch acceptance is not completion;reload final state under lock. Never sudo/pkexec/polkit/elevate/change groups or socket modes.

Read-gated GET /_redeven_proxy/api/container-resources/services returns modes/source IDs;one engine failure cannot hide another. Legacy state→engine,client_proxy→docker_cli.

Optional `diagnostic` separates observed discovery/management/health faults from `guidance_code` ownership advice. It contains only phase, typed code and observation time; never stderr, paths, endpoints or credentials. Permission, missing CLI, timeout, unreachable and unknown are distinct. Only a health probe can report stopped; management failure cannot establish running state. Successful refresh removes the previous diagnostic.

## Interaction
One preflight confirmation names service/localized risk/impact/action,no retyped name/second review. Client binds name,server identity/authority/request+plan hashes. Cancel creates no operation;duplicates locked. Hide hashes/raw prose;history resolves names/localized errors.

Settings warns. Header aligns square outlined Back/title independently of description;touch>=44px. Refresh retains cards,animates indicator only,errors inline. Known Desktop/unknown health retains disabled Start/guidance until revalidated. Active divider replaces controls with elapsed/cancel/secondary history;no invented percent/auto-open history. Failure offers recovery;SSE/poll completion reloads service/Runtime.

Current health leads;active work retains locks/feedback. Terminal start/restart failure on running card and stop failure on stopped card clear live feedback;unknown/config failures retain recovery. Completed/canceled remains history. Current running cannot rewrite failed restart. History separates original result/error/duration from current state;no empty error or historical live timer.

### Ask Flower
Existing cards prioritize a concise localized diagnostic over management guidance. Permission/unreachable/error states and stopped services without Start expose only the Flower icon in the existing action row, with a localized Ask Flower tooltip and accessible name. Read access and a ready resource suffice to ask; asking performs no configuration or lifecycle operation. Active operation controls retain their owner. Existing header Refresh revalidates the same cards and removes the assistance action after recovery.

The action opens the existing [contextual launcher](../ui/flower-activity-companion.md#shared-input-card) beside its button in Activity or Workbench, with one removable/previewable reference before an empty editor. No generated question, extra sidebar or setup wizard. `container_services` accepts only `text_snapshot`: a frozen allowlist of environment/service identity, observed state, available version/rootless/remote facts, capabilities, configuration source IDs, diagnostic, displayed summary, management guidance and capture time. Missing facts remain unknown. Raw configuration and secrets never enter the snapshot.

The existing current-runtime target and server admission own authority; snapshot facts never grant access or authorize elevation. Sending projects the snapshot into the existing canonical text reference/model context. The optional service response and paired Runtime-served Env App addition leave Runtime Service/placement protocols, Desktop request shapes and database schemas unchanged; no compatibility epoch changes.

# Boundaries

containerengine owns argv/validation/atomic replace-rollback/observation;containerresource preflight/impact/locks/sanitized durable state;API Read/RWX/Admin/no-store. Desktop/Machine/remote tools own private settings;admins installation/OS authority.

# Evidence

- `redeven:internal/containerengine/container_services_diagnostics_test.go` reproduces local Docker permission evidence hidden by host-manager guidance and checks bounded typed diagnostics. Desktop discovery tests separate management faults, health and recovery.
- `redeven:internal/envapp/ui_src/src/ui/utils/containerServiceAskFlower.test.ts`, `redeven:internal/flower_ui/src/contextActionWire.test.ts`, and `redeven:internal/ai/context_action_floret_test.go` verify immutable safe snapshots, text-only admission and model-visible canonical references.
- Containers page unit/browser acceptance covers read-only asking, no automatic mutation, refresh recovery, keyboard opening, preview/draft continuity and submission in Activity/Workbench at 320/390/1440px with English, Simplified/Traditional Chinese and light/dark themes. These fixtures do not claim a live host repair.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx`/browser:recovered lifecycle faults,active/config feedback,immutable history,responsive revalidation in English/zh-CN/zh-TW.
- `redeven:internal/containerengine/container_services.go` - Source.
- `redeven:internal/containerresource/desktop_lifecycle_qualification_test.go`:opt-in authorized real macOS preflight/operation/reconciliation,ordinary CI skips.2026-10-27 dev environment reproduces Docker4.52.0 fork-server `unmarshaling start request: unexpected EOF` via LaunchServices and earlier CLI. Removing Redeven metadata restores launch. Explicit app env plus58KiB synthetic metadata passes stop10.290s/start12.111s/restart22.354s,engine29.0.1,four container IDs preserved. Earlier shell-only test missed dev failure.
- Same date:45 browser cases (390px English/Chinese,1440px,poll controls/stream loss),158 UI/API/locale,Go race,typecheck/lint pass. Isolated built Desktop shows real service/native icons;actual stop/start uses production service separately from UI fixtures.
