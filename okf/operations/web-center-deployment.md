---
type: Operations Contract
title: Deploy and qualify standalone Web Center
tags: [operations, deployment, web, qualification]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Center binary/UI deploy separately from Desktop and Runtime. Evidence records source/artifacts, host, browser, real elapsed duration, cleanup and limits. Smoke tests cannot certify an eight-hour soak or a different native browser. Qualification uses isolated service names, ports and state, and preserves existing Runtime processes.

# Contract

## Versioned release artifacts

Center is independently installable alongside Runtime/Desktop under one repository tag. Center installation/upgrades never install/restart/upgrade either. Binding protocol/capability checks determine compatibility; shared tags alone do not.

Tagged releases require redeven-center_linux_amd64.tar.gz and redeven-center_linux_arm64.tar.gz, each with .tar.gz.manifest.json receipt, signed SHA256SUMS and remote byte readback. Native runners build/execute their architecture; either failure blocks release. macOS source builds are for development; no formal macOS/Windows service or published registry image.

Archives contain binary, ui/, two service units, environment examples, Docker/Compose/.env, licenses, DEPLOYMENT.md and manifest.json. version/--version reports tag/source/time without state. Manifests hash every file; reject dirty source, incorrect tag/source/architecture, missing/extra files, links/digest mismatch. Collector requires both architectures from one commit.

Download chosen release/architecture, verify signed checksums using release instructions and extract into a new version directory. Deployment needs no Node/Go/Electron/local Runtime. Compose builds locally from verified package and exact .env version; preserve .env/state on upgrade. Runtime installer does not install Center.

## Install

Source builds use .node-version, Desktop package manager, go.mod and published dependencies. scripts/build_center.sh <new-directory> [version] emits complete package; production requires explicit tag, omitted version is dev. Cross-builds require target execution.

serve requires --state-root/--origin/--tls-cert/--tls-key/--assets/--connector-socket/--connector-user and chosen --listen. Independent worker: connector --connector-socket ... --center-user <Center OS user>. Both verify exact peer UID before route credentials. Origin is immutable identity. Configure DNS/TLS SANs or wildcard for portal/Env/children. Center terminates TLS; edge TCP passthrough is allowed, forwarded headers confer no authority.

Linux: separate nonlogin redeven-center/redeven-connector accounts in redeven-center group; root-owned package at /opt/redeven-center. State /var/lib/redeven-center mode0700 and TLS keys readable only by Center. Install both units in /etc/systemd/system and example at /etc/redeven-center/center.env. Connector has no state, is denied Center state/config and owns /run/redeven-connector/connector.sock. Group traversal plus kernel peer UID authenticates Center. systemctl daemon-reload; systemctl enable --now redeven-center starts both without Runtime dependency. Connector restarts independently. Owner commands run as Center or root. Upgrades need stopped-state backup/explicit replacement, never recursive deletion.

Compose: build supplied Dockerfile from Linux package; Center UID10001/GID10001 and Connector UID10002 share socket volume, read-only roots/dropped capabilities. Only Center mounts state/TLS; ensure matching private ownership. Place tls/server.pem/server-key.pem readable by10001; set CENTER_ORIGIN and docker compose up --build -d. Exposed8443 must match DNS/SAN/external origin. Obtain setup credential with docker compose exec center /opt/redeven-center/redeven-center setup --state-root /var/lib/redeven-center. Preserve named volume; down -v deletes data. Operators provision public DNS/TLS.

## First use

1. Start service and verify `/healthz` through trusted HTTPS.
2. Run `redeven-center setup --state-root ...` as owner/root. Paste the temporary credential, set password, verify TOTP, save codes and sign in.
3. Add access-only Gateway, confirm fingerprint and register an Env origin.
4. Apply the descriptor on its Runtime through the owner CLI. Runtime password/MFA stay independent. Direct bookmarks do not exercise server relay.

## Recovery and upgrade

Stop Center and preserve `center.key`, `center.sqlite` and applicable SQLite sidecars together, with modes/ownership. Restore using the same origin and compatible binary. Restart invalidates devices but leaves Runtime services/workspaces separate. Never copy only a live database main file or only its key. Diagnose missing committed material instead of deleting it to reopen setup.

Use `redeven-center recover` for factor loss, or stop the service and use `recover --offline --origin ...`. Complete replacement factors through the browser. Route key rotation closes that route and requires applying the new descriptor with current Runtime binding revision. TLS renewal requires restart. Master-key re-encryption and changing pinned portal origin are not exposed workflows.

## Qualification

`scripts/check_center.sh` checks contracts, security packages, host behavior and UI build. `REDEVEN_CENTER_BROWSER=1 go test -tags=floeterm_native ./internal/localui -run '^TestCenterBrowserQualification$' ...` runs actual browsers/Gateway/Runtimes with trusted certificates. WebKit is not Safari.

`REDEVEN_CENTER_EXTERNAL_FIXTURE` selects explicit task-owned remote state; private factor material never enters Git/reports. Optional physical/model/container/large-file flags require actual components and cleanup. Model configuration use needs authorization; test threads are deleted.

`REDEVEN_CENTER_CAPACITY=1` creates 100 signed members, ten actual Runtime applications/tabs and 90 offline entries. `REDEVEN_CENTER_CONNECTOR_BIN` selects the built independent worker and verifies process restart. `REDEVEN_CENTER_SOAK_SECONDS=28800` requests eight real hours with persistent terminal/Flower subscriptions and terminal/file roundtrips. Resource samples distinguish fixture Go heap from fixture/worker process RSS; browser heap is not total browser memory. No paid generation occurs in soak; browser input uses ordinary activity policy. A stopped or failed preflight does not certify elapsed soak time.

`scripts/check_center_deployment.mjs <release>` checks standalone startup, setup, restart, recovery lock, missing-key and TLS name rejection. `scripts/check_center_linux_deployment.mjs <ssh-host> <staged-root> <address> <image>` runs the actual systemd template and nonroot container with Chrome, owner peer denial and online/offline recovery. It requires task-owned staged artifacts, TLS trusted by the test browser, sudo and explicitly authorized host access. It stops/removes its units and container; the caller removes its staged state and artifacts after inspecting evidence.

# Boundaries

The supported service templates require Linux and a trusted TLS identity. No installer provisions public DNS, certificates or a target Runtime automatically. A build manifest identifies its exact source snapshot and artifacts; later source changes require fresh affected qualification.

# Evidence

Hooks are procedures, never completed-pass claims. The external Chinese task report owns exact results/source/artifact manifests and open gates. udesk26 Chrome/2026-10-28 qualifies physical display/input/disconnect; backend reports no clipboard/audio. Manual text works; DPMS auto-wake and Safari remain unqualified (user chose Chrome).

Optional flags for scripts/check_center_browser.mjs:

| REDEVEN_CENTER_ suffix | Required scope |
| --- | --- |
| AUTH_BOUNDARIES=1 | Five wrong Runtime passwords, real cooldown and five-minute challenge expiry using server wall time |
| PERMISSIONS=1 | Actual Chrome clipboard denial; keyboard terminal command confirmed by independent Runtime file read, then cleanup |
| PORTAL_PERMISSIONS=1 | Binding copy denied, manual selection, exact clipboard after permission and explicit Retry |
| ASSETS=<directory> | Frozen prebuilt portal; never rebuild served long-test assets; record hashes and qualify later changes separately |
| UPLOADS=1 | Local model profile receives zero inference; multipart bytes/idempotency/staging/cleanup plus actual Flower selection/removal |
| NATIVE_PICKER=1 + HEADED=1 | Real OS chooser Cancel: one cancel/no change/no attachment, then successful selection; record Chrome distribution/version |
| NATIVE_SAVE=1 | File Browser native Download Cancel leaves retryable canceled record; Retry is a new attempt with exact bytes |
| NATIVE_SAVE_PERMISSIONS=1 | Pause selected real handle, remove owned-directory write permission, require visible createWritable failure; restore/Retry preserves outcomes and bytes; clean both hosts |
| TERMINAL_RECOVERY=1 | One UI command survives offline/reload/close/reopen; independent catalog/file reads and recovered UI prove one session/submission; another Env/Center unaffected; clean probes |
| FLOWER_RECOVERY=1 | Actual composer and bounded local model survive freeze/offline/reload/close/reopen; same thread/run/user/reply, separate title count, no duplicate inference/cancel; independent reads/UI and other Env/Center, then delete thread; no paid calls |
| CHILD_REOPEN=1 | Twenty actual Chrome Web Service handoffs on separate device reuse exact child cookie/resource, deny Env APIs; logout revokes that owner only; no budget increase |

Filechooser automation is distinct from OS cancellation. OS write modes are distinct from persistent browser grant revocation. Each lane covers only its named workload; none certifies every tool/approval/transfer/permission combination or eight-hour stability. Preserve failed long-test evidence and do not inherit qualification across changed source snapshots.
