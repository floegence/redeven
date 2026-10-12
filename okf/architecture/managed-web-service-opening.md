---
type: Runtime Contract
title: Managed Web Service opening
description: Prepare the current verified launch entrance and recover authentication without implicit lifecycle changes.
tags: [architecture, managed-services, security, desktop, recovery]
timestamp: 2026-10-12T00:00:00Z
---
# Summary

- Authority: the released template package owns entrance declarations and parsing; Runtime owns launch verification, preparation and private persistence; Desktop owns navigation results; Env App owns factual presentation.
- Outcome: Host, Container and Compose hand a verified current entrance to the existing protected Forward route, including an already-running instance after an upgrade.
- Invariants: opening never restarts, upgrades, reinstalls or modifies application data; one public preparation path owns results; HTTP 401 proves response availability, not authenticated access.
- Failure boundary: unverified ownership, launch changes, unavailable output and unsafe URLs fail with retryable or explicit recovery explanations. A preparation failure never stops a healthy application.

# Contract

## Sources and launch identity

TemplateSpec 7 accepts exactly one entrance source: a fixed endpoint path, the supported Host opening hook, or `startup_url.line_prefix`. The upstream pure parser takes the first complete URL after the exact prefix, excluding appended LAN descriptions. Historic documents are read through the frozen upstream adapters into this executor. Container and Compose never acquire permission to run Host scripts.

Runtime verifies the existing resource before reading output. Container generation contains the full container ID and exact RFC3339Nano `StartedAt`. Compose chooses the unique owned project container mapping the saved loopback protected port; it never aggregates project logs or guesses from a current template service name. Host uses its native birth identity and launch nonce. ID, PID, name and port alone cannot authorize cached authentication.

Current-launch output reads have a 16 MiB total bound and a 64 KiB parser line bound. Container command reads additionally have a ten-second deadline. Container reads use `logs --since <exact StartedAt> --tail all`. Host reads the private current-run output file. Missing or rotated output and an absent verified record require an explicitly chosen restart to produce a new entrance.

## One preparation owner

`open-session` observes the applied instance, prepares its entrance through one common owner, checks endpoint availability, and revalidates generation, applied identity, Forward and management state before handoff. Concurrent callers share the work; a cancelled observer does not cancel another caller's hook. An explicit refresh which joined a cached handoff still receives a refreshed result. Closing Runtime cancels outstanding work.

After a successful health check and the applied-identity commit, lifecycle owners attempt the same preparation as a best-effort step. An entrance error remains separate from process health. List and inspection never prepare an entrance or execute opening hooks. Their entrance projection reads only a private result whose generation still verifies.

Returned URLs must match the applied protocol, loopback host and actual mapped entrance port, contain no user information, and convert to a valid local path/query. Fixed deep links retain their queries and fragments. Only this relative navigation crosses into the existing authorized proxy; access mode and route admission remain unchanged.

Private record schema 2 binds service ID, launch generation, applied Runtime identity and digest, opening-rule digest, path, managed-authentication context and safe error classification. Schema 1 records enter through bounded identity-verified conversion. A verified old entrance can outlive a changed or unavailable template. A changed Host hook is never executed against an old launch to rebuild a missing record, and current template changes never silently replace a saved fixed path.

Runtime digest v2 excludes entrance-only declarations and normalized format versions. Frozen v1 comparison preserves historical applied identities without rewriting them. Imported-source execution identity hashes auxiliary file bytes separately from the source document; opening authority retains the full reviewed source identity. Changed business scripts and settings still require their normal lifecycle review.

## Browser outcome and recovery

`ready` means the entrance is ready for browser handoff. The compatible response adds `launch_generation` and, for managed authentication, `managed_entrance`. The response remains permission-gated and `no-store`. No list, audit, notification, ordinary URL display or diagnostic copy receives the token.

Desktop receives the initial verified handoff from Env App and uses the Environment's existing session HTTP lifecycle only for explicit repreparation, including E2EE sessions. Trusted IPC accepts only bounded replies from that same live main frame. Local routes retain their private authority or `/pf/<id>` prefix; remote bootstrap retains its exact Forward and entry ticket while replacing only the application path.

Only the first declared managed application document chain recognizes 401/403 as entrance authentication failure. Redirects retain that chain; boot documents and subresources do not consume it. A successful application document ends it, so later application login responses remain application content. The existing scriptless unavailable page offers an explicit reprepare-and-retry action through the same Runtime interface. It never silently changes access mode or restarts. The window remains closable; cancellation, timeout, failure and late results all terminate observation.

Browser-only handoff cannot reliably observe a cross-origin page and therefore does not report authenticated success. Diagnostic interaction and resource confirmation follow [management recovery](service-management-recovery.md). Per-service progress follows [Web Services interface](web-services-interface.md).

## Qualification ownership

`scripts/qualify_managed_web_opening.sh` is the dedicated real-service lane. It uses released dependencies with `GOWORK=off`, isolated owned processes/state, exact Docker digests, Host and Compose launch changes, authenticated Electron redirects/Cookies, painted content, refresh and window reopening in a fresh isolated partition. The protected-route case exercises OpenSession, authentication through the actual Forward proxy, and uninstall revocation. Ordinary CI and push gates do not duplicate this suite. A failed Electron runtime preflight is an explicit environment failure; qualification cannot alter macOS trust or sign dependencies.

# Evidence

- `redeven:internal/managedwebservice/opening_prepare.go` - Common source validation, private cache and generation checks.
- `redeven:internal/managedwebservice/opening_launch.go` - Native and container launch authority, including unique Compose entrance selection.
- `redeven:internal/containerengine/startup_logs.go` - Bounded current-launch output reads.
- `redeven:internal/managedwebservice/open_session.go` - Shared handoff and final resource validation.
- `redeven:internal/managedwebservice/runtime_identity_compat.go` - Frozen identity comparison without executing historical code.
- `redeven:desktop/src/main/managedWebEntranceNavigation.ts` - First-document authentication boundary and address redaction.
- `redeven:internal/envapp/ui_src/src/ui/services/sessionHTTP.ts` - Existing lifecycle preparation for trusted Desktop requests.
- `redeven:scripts/qualify_managed_web_opening.sh` - Dedicated real-service and browser qualification.
