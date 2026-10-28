---
type: Operations Contract
title: Deploy and qualify standalone Web Center
description: Operate independent entry services with private state and reproducible evidence.
tags: [operations, deployment, web, qualification]
timestamp: 2026-10-28T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Center binary/UI deploy separately from Desktop and Runtime. Evidence records source/artifacts, host, browser, real elapsed duration, cleanup and limits. Smoke tests cannot certify an eight-hour soak or a different native browser. Qualification uses isolated service names, ports and state, and preserves existing Runtime processes.

# Contract

## Install

Use `.node-version`, Desktop package-manager declaration, `go.mod` and published dependencies. `scripts/build_center.sh <new-directory>` produces binary/UI and systemd/env/Docker templates. Cross-compiled output needs target-host testing.

Start `redeven-center serve` with required `--state-root`, `--origin`, `--tls-cert`, `--tls-key`, `--assets`, `--connector-socket`, `--connector-user`, and chosen `--listen`. Run the separate worker with `connector --connector-socket ... --center-user <Center OS user>`. Both sides verify the configured OS peer UID before exchanging route credentials. Origin is immutable identity. Valid TLS must cover portal, Env and derived child origins. Configure DNS and wildcard/SAN certificates. TLS terminates in Center; an edge may use TCP passthrough. Forwarded headers confer no authority.

Linux service uses account `redeven-center`, state `/var/lib/redeven-center` mode 0700 and binaries/UI `/opt/redeven-center`. It has no Runtime dependency. Docker runs UID/GID 10001; mount ownership must match with private permissions.

For a new Linux installation, create separate system accounts `redeven-center` and `redeven-connector` with no login shells, both in group `redeven-center`. Copy one matching package into root-owned `/opt/redeven-center`, install both supplied units into `/etc/systemd/system`, and create `/etc/redeven-center/center.env` from the example. Keep state and TLS keys readable only by Center. The Connector unit has no state directory, denies access to Center state/config and owns `/run/redeven-connector/connector.sock`; group access lets Center connect, and kernel peer credentials enforce its exact UID. `systemctl daemon-reload` and `systemctl enable --now redeven-center` start both units. Connector can restart independently. Run owner CLI commands with `sudo -u redeven-center` or root. Existing installations require a stopped-state backup and explicit artifact replacement, not blind recursive deletion.

Build the Dockerfile from a Linux release directory. The supplied `compose.yaml` runs Center as UID 10001 and Connector as UID 10002, with a shared socket volume and dropped capabilities/read-only roots. Only Center mounts state and TLS. Put certificates at `tls/server.pem` and `tls/server-key.pem`, readable by UID 10001, set `CENTER_ORIGIN`, and run `docker compose up --build -d`. The manifest publishes port 8443; DNS and SANs must match that external origin. Run `docker compose exec center /opt/redeven-center/redeven-center setup --state-root /var/lib/redeven-center` for the temporary credential. Keep the named state volume on upgrades; `down -v` deletes persistent data. Public DNS and TLS provisioning remain operator responsibilities.

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

Optional test hooks are procedures, not completed-pass claims. The external Chinese task report tracks results and remaining gates. udesk26 Chrome acceptance on 2026-10-28 confirms display/input/disconnect; its published backend reports no clipboard/audio and supports manual text input. DPMS auto-wake and actual Safari remain unqualified; the user selected Chrome.

`REDEVEN_CENTER_AUTH_BOUNDARIES=1` additionally exercises five incorrect Runtime passwords, the real cooldown, and five-minute challenge expiry through the browser UI. It waits on server wall time instead of replacing the browser clock. `REDEVEN_CENTER_PERMISSIONS=1` uses actual Chrome permission overrides to deny clipboard read/write, verifies the browser rejection, and types a terminal command using keyboard events. A separate Runtime read verifies the resulting file before task-owned terminal/file cleanup. These checks do not certify native file-picker cancellation, directory permission revocation, or every browser permission combination.

`REDEVEN_CENTER_PORTAL_PERMISSIONS=1` verifies binding-copy denial, explicit manual text selection, and exact clipboard contents after permission is granted and the user retries. `REDEVEN_CENTER_ASSETS` selects an isolated prebuilt portal asset directory for qualification. Never rebuild or replace assets served by a running long test; record source and artifact hashes, and qualify later UI changes separately.

`REDEVEN_CENTER_UPLOADS=1` enables an isolated model profile whose local endpoint must receive zero inference requests. It exercises the production browser multipart uploader, byte digests, idempotency, staging capabilities and cleanup, then Flower's actual file-selection and removal controls. Browser filechooser automation verifies the application's chosen-file flow; it does not certify operating-system picker cancellation or directory permission revocation.

Adding `REDEVEN_CENTER_NATIVE_PICKER=1` with `REDEVEN_CENTER_HEADED=1` pauses at a visible Flower composer for a real operating-system chooser interaction. The operator opens Add attachments and cancels; the harness verifies one native cancel event, no change event, no attachment, and successful subsequent selection. Record the exact Chrome distribution/version. This does not certify persistent directory grants or other browser permissions.

`REDEVEN_CENTER_NATIVE_SAVE=1` with a visible Chrome browser qualifies the File Browser's actual Download command and native save dialog: Cancel leaves a retryable canceled record, and Retry creates a new attempt with exact saved bytes. `REDEVEN_CENTER_NATIVE_SAVE_PERMISSIONS=1` additionally pauses the real selected handle while the task owner removes write access from its isolated destination directory. Production `createWritable` must fail visibly; restoring access and retrying must preserve prior outcomes and byte integrity. The fixture removes local and Runtime probe files. OS directory modes are distinct from browser permission revocation; this check does not certify persistent directory grants or all browser permission combinations.
