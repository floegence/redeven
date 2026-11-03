---
type: Architecture Contract
title: Container engine service management
tags: [architecture, containers, docker, podman, host-control]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

One ContainerServiceController owns Docker/Podman discovery, lifecycle, configuration, preflight identity and reconciliation. Opaque IDs hide endpoints; mutation requires full RWX/Admin without elevation. Unknown owner/revision/final state fails closed, never replaying interrupted work.

# Contract

## Identity/execution
Discover engines independently,one service each,no inactive-context scan/fallback. Share two-second command budget per engine; health reuses selected endpoint. Resource readiness separately bounded. Desktop requires selected desktop-linux/desktop-windows or exact endpoint alias; installed plugin proves no ownership. Use docker desktop version --format json,not slow status. Resolve Podman Machine before health.

Known management/health faults retain ID/implementation/config sources/actions. Missing CLI/permission/timeout/unknown is not stopped. Start needs stopped;Stop/Restart running;save-and-restart needs known state before write,plain save remains.

Lifecycle shares two minutes across steps vs ten-second queries/two-second discovery,parent deadline/cancel honored. macOS Start uses /usr/bin/open -g -b com.docker.docker then bounded poll;Restart stops first. Other platforms/Stop use official CLI. LaunchServices allowlists identity/home/PATH/temp/shell/locale/timezone/proxy/certificates,excluding Redeven metadata,Electron/Node controls,CLI overrides,secrets. Explicit empty env stays empty;CLI/probes unchanged. Launch acceptance is not completion;reload final state under lock. Never sudo/pkexec/polkit/elevate/change groups or socket modes.

Read-gated GET /_redeven_proxy/api/container-resources/services returns modes/source IDs;one engine failure cannot hide another. Legacy state→engine,client_proxy→docker_cli.

## Interaction
One preflight confirmation names service/localized risk/impact/action,no retyped name/second review. Client binds name,server identity/authority/request+plan hashes. Cancel creates no operation;duplicates locked. Hide hashes/raw prose;history resolves names/localized errors.

Settings warns. Header aligns square outlined Back/title independently of description;touch>=44px. Refresh retains cards,animates indicator only,errors inline. Known Desktop/unknown health retains disabled Start/guidance until revalidated. Active divider replaces controls with elapsed/cancel/secondary history;no invented percent/auto-open history. Failure offers recovery;SSE/poll completion reloads service/Runtime.

Current health leads;active work retains locks/feedback. Terminal start/restart failure on running card and stop failure on stopped card clear live feedback;unknown/config failures retain recovery. Completed/canceled remains history. Current running cannot rewrite failed restart. History separates original result/error/duration from current state;no empty error or historical live timer.

# Boundaries

containerengine owns argv/validation/atomic replace-rollback/observation;containerresource preflight/impact/locks/sanitized durable state;API Read/RWX/Admin/no-store. Desktop/Machine/remote tools own private settings;admins installation/OS authority.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.test.tsx`/browser:recovered lifecycle faults,active/config feedback,immutable history,responsive revalidation in English/zh-CN/zh-TW.
- `redeven:internal/containerengine/container_services.go` - Source.
- `redeven:internal/containerengine/container_services_desktop_test.go` - Tests.
- `redeven:internal/containerresource/desktop_lifecycle_qualification_test.go`:opt-in authorized real macOS preflight/operation/reconciliation,ordinary CI skips.2026-10-27 dev environment reproduces Docker4.52.0 fork-server `unmarshaling start request: unexpected EOF` via LaunchServices and earlier CLI. Removing Redeven metadata restores launch. Explicit app env plus58KiB synthetic metadata passes stop10.290s/start12.111s/restart22.354s,engine29.0.1,four container IDs preserved. Earlier shell-only test missed dev failure.
- Same date:45 browser cases (390px English/Chinese,1440px,poll controls/stream loss),158 UI/API/locale,Go race,typecheck/lint pass. Isolated built Desktop shows real service/native icons;actual stop/start uses production service separately from UI fixtures.

- `redeven:internal/containerresource/desktop_lifecycle_qualification_test.go` - Tests.
