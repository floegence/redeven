---
type: Operations Contract
title: Deploy and qualify standalone Web Center
tags: [operations, deployment, web, qualification]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Center binary/UI deploy independently of Runtime/Desktop. Qualification records source/artifacts, host/browser, real duration, cleanup and limits using isolated names/ports/state. Preserve existing Runtime; smoke checks certify neither eight-hour soak nor a different native browser.

# Contract

## Release/install
Same tag, independent install/upgrade; protocol/capability decides compatibility. Formal Linux amd64/arm64 archives require manifests,signed SHA256SUMS,remote readback and native execution on both targets. Either failure blocks; macOS source is development only, no Windows/macOS service/registry image.

Package:binary/UI,two units,env examples,Docker/Compose/.env,licenses,DEPLOYMENT.md,manifest. --version reads source/time without state. Reject dirty source,extra/missing/link/mismatched files/target/tag/digest; both targets share commit. Extract verified signed bytes into new version directory. Target needs no compiler/Electron/Runtime. Compose uses package/exact.env and retains state/settings. Runtime installer excludes Center.

Pinned Node/Desktop package manager/Go/public deps build via build_center.sh <new-directory> [version]; default dev,production requires tag. Cross-build is insufficient without target execution.

serve requires state-root/origin/tls-cert/tls-key/assets/connector-socket/connector-user/listen. Connector uses socket/center-user; both check peer UID before credentials. Origin immutable; DNS/TLS covers portal/Env/children. Center terminates TLS; edge TCP passthrough allowed, forwarded headers grant nothing.

Linux:nonlogin redeven-center/redeven-connector shared group; root-owned/opt/redeven-center;0700/var/lib/redeven-center and readable keys. Install units,/etc/redeven-center/center.env; Connector owns/run/redeven-connector/connector.sock without config/state access. Group traversal/kernel UID authenticates. daemon-reload; enable --now redeven-center starts both independently. Owner commands require Center/root. Stop/backup/explicit replacement before upgrade,never recursive deletion.

Compose:Linux Dockerfile,Center UID/GID10001,Connector UID10002,shared socket,read-only roots/dropped capabilities. Only Center mounts state/TLS;tls/server.pem/server-key.pem readable by10001. Set CENTER_ORIGIN then compose up --build -d;8443 matches DNS/SAN. Exec setup yields temporary credential. Preserve volume;down -v deletes data. Operator owns DNS/TLS.

## Recovery
Trusted HTTPS/healthz first; owner setup then browser password/TOTP/recovery codes. Confirm Gateway fingerprint, add access-only route,assign Env origin,apply descriptor via Runtime owner CLI. Factors independent; direct bookmarks bypass server relay.

Stop before backing up key/database/sidecars with modes/owner; restore same origin/compatible binary. Restart invalidates devices,not Runtime workspaces. Never copy only live SQLite/key or delete committed material to reopen setup. Factor loss:recover or stopped recover --offline --origin,then browser factors. Route-key rotation closes exact route,needs new descriptor/current revision. TLS renewal restarts; no master-key reencryption/origin change API.

## Qualification
check_center.sh covers contracts/security/host/UI. REDEVEN_CENTER_BROWSER=1 TestCenterBrowserQualification with floeterm_native uses actual browser/Gateway/Runtime/trusted TLS; WebKit≠Safari. EXTERNAL_FIXTURE picks owned remote state. Keep factors private; optional physical/model/container/file lanes need actual components/cleanup. Authorized model tests delete threads.

CAPACITY=1:100 signed members,ten live tabs/90 offline. CONNECTOR_BIN selects built worker/restart. SOAK_SECONDS=28800: eight real hours with terminal/Flower subscriptions/file roundtrips,no paid inference. Separate fixture heap/RSS/browser memory. Failed/stopped preflight proves no soak.

check_center_deployment.mjs:package startup/setup/restart/recovery/missing-key/TLS denial. check_center_linux_deployment.mjs <ssh-host> <staged-root> <address> <image>:systemd/nonroot container/Chrome/peer denial/factor recovery. Require owned artifacts,TLS,sudo,authorized host. Tool removes units/container; caller removes staging/state after review.

# Boundaries

Linux/trusted TLS required. Installer provisions no DNS/certificates/target Runtime. Manifests bind source/artifacts; changed sources require affected requalification.

# Evidence

Procedures are not pass claims. External Chinese task report retains source/artifacts/results/open gates. udesk26 Chrome,2026-10-28:physical display/input/disconnect; no backend clipboard/audio. Manual text works; DPMS wake/Safari unqualified(user chose Chrome).

Optional scripts/check_center_browser.mjs flags, REDEVEN_CENTER_ prefix:

| Suffix | Required evidence |
| --- | --- |
| AUTH_BOUNDARIES=1 | Five wrong Runtime passwords,real cooldown/five-minute server-time challenge expiry |
| PERMISSIONS=1 | Actual clipboard denial;terminal keyboard command independently verified in Runtime file,cleanup |
| PORTAL_PERMISSIONS=1 | Denied binding copy,manual selection,exact clipboard after grant/explicit Retry |
| ASSETS=<directory> | Frozen portal;no rebuilding long-test assets,record hashes/requalify changes |
| UPLOADS=1 | Zero inference;multipart bytes/idempotency/staging/cleanup and actual Flower select/remove |
| NATIVE_PICKER=1 + HEADED=1 | Real OS Cancel once,no change/attachment,then select;record Chrome version/distribution |
| NATIVE_SAVE=1 | Native Download Cancel remains retryable;new attempt verifies exact bytes |
| NATIVE_SAVE_PERMISSIONS=1 | Pause real handle,remove owned write permission,visible createWritable failure;restore/Retry exact outcomes/bytes,clean both hosts |
| TERMINAL_RECOVERY=1 | One command/session through offline/reload/close/reopen;independent catalog/file/UI proof,other Env/Center unaffected,cleanup |
| FLOWER_RECOVERY=1 | Composer/bounded local model through freeze/offline/reload/reopen;same thread/run/user/reply,title count separate,no duplicate inference/cancel;independent proof,other Env/Center retained,delete thread,no paid calls |
| CHILD_REOPEN=1 | Twenty real Chrome handoffs on separate device reuse exact cookie/resource,deny Env API;logout revokes exact owner,no budget increase |

Automated filechooser≠OS cancel; OS write modes≠persistent browser grant revocation. Lanes qualify named workload only,not every tool/approval/transfer/permission or eight-hour stability. Retain failed long tests; changed source inherits no pass.
