---
type: Operations Contract
title: Deploy and qualify standalone Web Center
tags: [operations, deployment, web, qualification]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Center binary/UI deploy separately from Desktop and Runtime. Evidence records source/artifacts, host, browser, real elapsed duration, cleanup and limits. Smoke tests cannot certify an eight-hour soak or a different native browser. Qualification uses isolated service names, ports and state, and preserves existing Runtime processes.

# Contract

## Release and install
Center installs independently beside Runtime/Desktop under one tag; upgrades never touch those services. Protocol/capability admission, not shared tag, decides compatibility. Formal artifacts are Linux amd64/arm64 archives with .manifest.json receipts, signed SHA256SUMS and remote readback. Native jobs execute each target; either failure blocks. macOS source is development only, no Windows/macOS service or registry image.

Archive contains binary/UI, two units, environment examples, Docker/Compose/.env, licenses, DEPLOYMENT.md and manifest. --version reports source/time without state. Verify every file/target/tag/digest; reject dirty source, extras/missing files, links or mismatch. Both targets share commit. Extract verified signed bytes into a new version directory. Target needs no build toolchain/Electron/local Runtime. Compose builds from package and exact .env; upgrades preserve state/settings. Runtime installer does not install Center.

Source uses pinned Node, Desktop package manager, Go and public dependencies. build_center.sh <new-directory> [version] emits complete package; omitted version is dev, production requires tag. Cross-builds need real target execution.

serve requires state-root/origin/tls-cert/tls-key/assets/connector-socket/connector-user/listen. Separate connector uses socket and center-user; both verify peer UID before credentials. Origin is immutable. DNS/TLS covers portal/Env/children; Center terminates TLS, edge TCP passthrough allowed, forwarded headers grant nothing.

Linux: nonlogin redeven-center/redeven-connector share group; root-owned /opt/redeven-center; private 0700 /var/lib/redeven-center and Center-readable keys. Install units plus /etc/redeven-center/center.env; Connector owns /run/redeven-connector/connector.sock without state/config access. Group traversal/kernel UID authenticate. daemon-reload and enable --now redeven-center start both independently of Runtime. Owner commands require Center/root. Stop-state backup/explicit replacement precede upgrade, never recursive deletion.

Compose: supplied Linux Dockerfile, Center UID/GID10001, Connector UID10002, shared socket, read-only roots/dropped capabilities. Only Center mounts private state/TLS. tls/server.pem/server-key.pem readable by 10001; configure CENTER_ORIGIN then compose up --build -d. Port 8443 must match external DNS/SAN. Exec Center setup for temporary credential. Preserve named volume; down -v deletes data. Operator owns DNS/TLS.

## First use and recovery
Verify trusted HTTPS /healthz. Owner runs setup with state root, then browser password/TOTP/recovery codes. Add access-only Gateway after fingerprint confirmation, assign Env origin and apply descriptor through Runtime owner CLI. Runtime factors stay independent; direct bookmarks bypass server relay.

Stop Center before preserving key/database/sidecars together with ownership/modes. Restore same origin/compatible binary. Restart invalidates devices, not Runtime workspaces. Never copy only live SQLite main/key or delete missing committed material to reopen setup. Factor loss uses recover or stopped offline recover --origin, completing browser factors. Route-key rotation closes exact route and requires new descriptor/current revision. TLS renewal restarts; master-key reencryption/pinned-origin changes are not exposed.

## Explicit qualification
check_center.sh verifies contracts/security/host/UI. REDEVEN_CENTER_BROWSER=1 Go TestCenterBrowserQualification with floeterm_native uses real browsers/Gateway/Runtimes and trusted TLS; WebKit is not Safari. EXTERNAL_FIXTURE selects owned remote state. Private factors stay out of Git; optional physical/model/container/file lanes require actual components and cleanup. Authorized model tests delete threads.

CAPACITY=1 creates 100 signed members/ten live Runtime tabs/90 offline. CONNECTOR_BIN selects built worker and tests restart. SOAK_SECONDS=28800 needs eight actual hours with terminal/Flower subscriptions and file roundtrips, no paid generation. Separate fixture heap from process RSS/browser memory. Failed/stopped preflight proves no soak time.

check_center_deployment.mjs validates package startup/setup/restart/recovery/missing-key/TLS denial. check_center_linux_deployment.mjs <ssh-host> <staged-root> <address> <image> runs real systemd/nonroot container with Chrome, peer denial and factor recovery. Require owned artifacts/trusted TLS/sudo/authorized host. Tool removes its units/container; caller removes staged artifacts/state after evidence review.

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
