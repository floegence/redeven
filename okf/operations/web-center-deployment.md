---
type: Operations Contract
title: Deploy and qualify standalone Web Center
tags: [operations, deployment, web, qualification]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Center binary/UI deploy separately from Runtime/Desktop. Package contains binary/UI,two units,environment examples,Docker/Compose/.env,licenses,DEPLOYMENT.md and manifest. --version reads source/time without state. Reject dirty source and extra/missing/link/mismatched target/tag/digest; both targets share commit.

# Contract

## Release/install
Same tag, independent lifecycle; protocol/capability decides compatibility. Linux amd64/arm64 formal archives need manifests/signed checksums/public readback/native execution on both; either failure blocks. macOS source is development only, no Windows/macOS service/registry image. Extract verified immutable bytes into new version directory; receiver needs no compiler/Electron/Runtime. Compose retains state/settings; Runtime installer excludes Center.

Pinned Node/Desktop manager/Go/public dependencies build via build_center.sh <new-directory> [version]; dev default, production requires tag. Cross-build alone is insufficient. serve requires state-root/origin/TLS pair/assets/connector-socket/user/listen. Both socket peers check UID before credentials. Immutable origin/DNS/TLS covers portal/Env/children; Center terminates TLS, TCP passthrough allowed, forwarded headers grant no trust.

Linux nonlogin center/connector users share group; root-owned/opt/redeven-center,0700state/readable keys,/etc environment and units. Connector owns/run socket without state/config access; kernel UID/group traversal authenticate. daemon-reload/enable --now center starts both. Owner commands need Center/root. Stop/backup/explicit replacement precedes upgrade, never recursive deletion.

Compose uses Linux CenterUID/GID10001/Connector10002/shared socket, read-only roots/dropped capabilities; only Center mounts state/TLS readable by10001. Set CENTER_ORIGIN, compose up --build -d,8443/DNS/SAN, exec setup for temporary credential. Preserve volume:down -v deletes data. Operator owns DNS/TLS.

## Recovery
Trusted HTTPS/healthz→owner setup→browser password/TOTP/recovery. Verify Gateway fingerprint, access-only route and Env origin; Runtime owner applies descriptor. Factors independent, direct bookmarks bypass relay. Stop before backing up key/DB/sidecars with modes/owner; restore same origin/compatible binary. Restart invalidates devices, not workspaces. Never copy only liveSQLite/key or delete material to reopen setup. Factor loss uses recovery or stopped recover --offline --origin, then browser factors. Route-key rotation closes exact route/requires descriptor/current revision. TLS renewal restarts; no master-key reencryption/origin mutation API.

## Qualification
check_center.sh covers contracts/security/host/UI. REDEVEN_CENTER_BROWSER=1 TestCenterBrowserQualification with floeterm_native uses actual browser/Gateway/Runtime/trustedTLS; WebKit is not Safari. EXTERNAL_FIXTURE selects owned remote state. Keep factors private; optional physical/model/container/file lanes require components/cleanup; authorized model tests delete threads.

CAPACITY=1 uses100signed members/10live tabs/90offline; CONNECTOR_BIN selects actual worker/restart. SOAK_SECONDS=28800 runs eight real hours of terminal/Flower/file roundtrips without paid inference. Separate fixture heap/RSS/browser memory; stopped/failed preflight proves no soak.

check_center_deployment.mjs covers package/setup/restart/recovery/key/TLS denial. Linux runner(host,staged-root,address,image) covers systemd/nonroot container/Chrome/peer denial/recovery; requires owned artifacts/TLS/sudo/authorized host. Runner removes owned units/container, caller reviews/removes staging/state.

# Boundaries

Linux/trustedTLS required; installer provisions no DNS/cert/target Runtime. Changed source needs affected requalification. Procedures are not passes; private reports retain source/results/failures. October28 udesk26 Chrome verified display/input/disconnect, no backend clipboard/audio; manual text passed, DPMS/Safari unqualified.

# Evidence

Optional check_center_browser.mjs lanes use REDEVEN_CENTER_ prefix:
- AUTH_BOUNDARIES:five wrong passwords/real cooldown/five-minute expiry.
- PERMISSIONS:actual clipboard denial, keyboard terminal effect verified in Runtime file; PORTAL_PERMISSIONS:denied copy/manual selection/exact clipboard after grant+Retry.
- ASSETS:frozen directory/hashes, no long-test rebuild. UPLOADS:zero inference, multipart bytes/idempotency/staging/cleanup/select/remove.
- NATIVE_PICKER+HEADED:actual OS Cancel unchanged then selection, Chrome/distribution identity. NATIVE_SAVE:cancel retryable then exact bytes. NATIVE_SAVE_PERMISSIONS:pause actual handle/remove owned write permission/visible createWritable failure/restore/Retry/clean both hosts.
- TERMINAL_RECOVERY:one command/session through offline/reload/close/reopen with independent file/catalog/UI proof, other environments retained.
- FLOWER_RECOVERY:composer/bounded local model across freeze/offline/reload/reopen, same thread/run/user/reply, title counts separate, no duplicate inference/cancel/paid call; independent proof/cleanup.
- CHILD_REOPEN:20real Chrome handoffs on separate device, same cookie/resource, EnvAPI denial/logout exact revoke/no budget growth.

Automation filechooser is not OS Cancel; file modes are not persistent browser-grant revocation. Named lanes qualify no universal tools/transfers/permissions/eight-hour stability. Preserve failures; changed sources inherit no pass.
