---
type: Desktop Contract
title: Desktop runtime bridge
description: Canonical navigation and security boundary for Desktop-integrated Runtime access and direct lifecycle.
tags: [desktop, runtime, bridge, lifecycle]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

Redeven Desktop opens Runtime instances through machine-readable startup, scoped transport, session, and process contracts. Runtime remains independently runnable without Gateway. Redeven-managed lifecycle actions use the registered Local, WSL, SSH, or container direct channel and are owned by Desktop's process-local coordinator; Gateway and Provider remain access-only. This overview is the canonical navigation point for readiness, recovery, WSL/SSH operations, and model/session integration. Focused concepts own the independent details while this concept retains the boundary between Desktop lifecycle coordination, Runtime services, optional access forwarding, and plugin capabilities.

# Contract

## Mechanism

This concept is the stable overview for the subject. Detailed contracts are maintained in the focused concepts below:

- [Desktop runtime readiness](desktop-runtime-readiness.md)

- [Desktop transport recovery](desktop-transport-recovery.md)

- [Desktop SSH runtime operations](desktop-ssh-runtime-operations.md)

- [Desktop WSL runtime operations](desktop-wsl-runtime-operations.md)

- [Desktop session and model source](desktop-session-model-source.md)

Native Local Environment transport is independent from public Local UI addressing. Runtime writes `local_ui_bridge_url` and a fresh 256-bit `local_ui_bridge_token` into local socket status and the private `0600` Desktop launch report. Public `local_ui_url` and `local_ui_urls` describe actual HTTP or HTTPS client entries even while Desktop uses its bridge. WSL, SSH, and container hello responses carry public URLs separately from the private token over stdio. Native BrowserWindow loading, health verification, access unlock, and Desktop Flower requests use the validated HTTP loopback-IP root plus that token without falling back to a public interface. Electron injects the header only for requests and upgrades to its authorized bridge authority, after diagnostics capture the token-free request.

Welcome and settings display only Runtime-reported public URLs as copyable, shareable client entries. Desktop bridge use is not an exclusive environment access mode: other Desktops and browsers may connect concurrently through the public address. A stopped Runtime has no current address, even when an old session or startup record remains. Saved bind and protocol are editable next-start settings and never synthesize an online URL. Settings put current connection and Desktop/browser actions above independent scope, password, protocol, port, and advanced listening controls. Changing a draft leaves the current address intact until a new startup report arrives. Private URLs and tokens never become endpoints, clipboard values, QR payloads, or system-browser targets.

Narrow settings windows keep the current URL on its own full-width row, with copy and share actions below it. Translated action labels must not compress the address into a narrow column; the footer remains visible while configuration content scrolls.

Background snapshots refresh connection details while preserving expanded settings sections, scroll position, input focus, selection and unsaved edits. Certificate state and pending operations belong to the actual Environment ID, not the snapshot object. Only a target change or reopening the certificate section initializes a new check; explicit refresh remains available. Responses from a previous target or closed section are ignored.

Missing saved protocol settings use HTTP on load and startup, including existing Environment catalogs. The connection security control selects HTTP without a confirmation or certificate prompt. Explicit HTTPS remains unchanged. When saving a stopped Environment, Desktop supplies any retained password with `keep` to the Runtime authority. Runtime may establish a missing verifier, but never replaces an existing server password unless the user explicitly chooses replacement.

HTTPS settings show certificate validity and this client's system trust separately. A compact panel places each action beside its certificate or trust status and shows validity dates without expansion. Its labeled refresh action checks status without resetting the section. Collapsed details contain the public certificate path and bounded, selectable diagnostics with an explicit copy action; copy failures leave the text available. Cancellation uses a neutral retry message, while actual operation failures use an alert.

The explicit local "Create and trust on this device" action lets the main process inspect, create only a missing certificate, request current-user trust, and verify the result. Retrying reuses a valid identity; cancellation and installation failure keep it usable. Certificate IPC binds an explicit registered management target, and obsolete UI results cannot update another Environment. The epoch 18 legacy `failed + ready + untrusted` status means an intact identity awaiting client trust. Remote server trust never establishes client trust. Certificate changes apply immediately and survive canceling the settings draft. HTTPS restart is disabled during checks and mutations, and the main process rechecks the saved HTTPS identity before stopping the running Runtime; untrusted valid identities remain allowed. Saving next-start settings does not require an immediately usable certificate.

Managed server settings read and save the selected Runtime's access configuration through its private control channel, or the authorized host CLI while stopped. The same single-column settings surface uses "Only this server" for remote loopback and never opens that address in the client browser. Public network addresses remain copyable and shareable, and SSH connection details have a separate management-connection action. URL registrations edit connection information only. Remote certificate checks and generation run on the selected server; each client must explicitly trust its public CA. Runtime retains the password verifier for independent restarts as specified by [Local UI network exposure](../security/local-ui-network-exposure.md).

When the server cannot return its settings, Desktop keeps the management connection editor available with the connection failure. Password inputs validate the 72-byte UTF-8 limit before saving. A failed server settings write restores the prior password verifier and reports the failure; it must not claim that an incomplete save succeeded.

Saved access changes remain visibly pending across dialog reopenings until a new Runtime applies them. The pending report belongs to one process start identity, including password-only changes; it does not replace the current URL. Native settings remain accessible for older Runtimes, but saving through the new authority requires stopping or updating that Runtime first.

Native Open and its cold-start recovery share the same target operation key, so the lifecycle owner can authorize startup before the window session exists. Library running counts follow Runtime health independently of open windows. Welcome does not publish a second cached startup plan alongside current Runtime presence.

Local Runtime starts detached with file-backed logs, so closing the initiating Desktop cannot terminate it through broken stdout/stderr pipes. Each client closes only its own session; explicit authorized lifecycle actions remain the sole stop/restart path. URL clients receive connection access without SSH or process-management authority. SSH and container startup honor saved Runtime access configuration rather than replacing it with a dynamic loopback bind. Development scripts announce configuration as pending until Runtime reports the actual listener; a one-start bind override preserves the saved port.

Each WSL, SSH, or container Runtime placement owns one long-lived `desktop-bridge` exec and one HTTP/2 session over that exec's stdio. SSH and SSH-container placements additionally own one credential-scoped SSH transport lease. macOS/Linux reuse ControlMaster; Windows runs the Bridge in one native OpenSSH child, as defined by [SSH transport](desktop-ssh-runtime-operations.md). Node composes stdin and stdout into the HTTP/2 client connection; Go serves the peer with `http2.Server.ServeConn`. There is no TCP listener, TLS, HTTP/1, Upgrade, Redeven frame codec, stream-id allocator, or global read scheduler at this boundary. The session protocol is exactly `redeven-desktop-placement-h2/1`; older bridge protocols fail with an update requirement and are never negotiated or retried as a fallback.

`local-ui`, `runtime-control`, and `gateway-protocol` are independent HTTP/2 CONNECT streams. The internal `openStream(surface)` interface remains the only caller boundary. Hello and Runtime shutdown are bounded control requests on the same session. The connection allows at most 64 concurrent streams, a 256 KiB receive window per stream, a 16 MiB connection receive window, 32 MiB of Node session memory, and bounded header count and size. Fifteen seconds without inbound frames starts one PING; ten seconds without its acknowledgement closes the session. A stream reset or half-close affects only that stream. Stdio, exec, SSH, GOAWAY, or HTTP/2 termination is recovered once by the existing SSH placement owner with a fresh exec and session; individual streams do not reconnect or replay. A terminated WSL bridge stays offline until an explicit Open, Start, or Retry action creates a new bridge.

Managed readiness records store only Runtime PID, start identity, Runtime Service state, and placement. They never retain an executable path, bridge URL, token, runtime-control credential, or a URL from a bridge that has already closed. The standard managed executable is derived once from the live placement when Desktop opens the bridge. Open creates or reuses that one live placement bridge and derives the Env App base, entry, display, and allowed URL only from its live record. SSH target identity contains no URL. External URL, Provider, and Gateway paths continue to own and validate their explicit public URL and cannot borrow the managed private bridge path.

Successful Env App shell and entry-asset validation may be reused only inside the current Desktop process for the same registered target, process start identity, and Runtime Service build identity. Replacement loopback proxy ports do not invalidate that package fact, while a different target or changed process/build identity always validates again and failed validation is never cached. This cache does not reuse authorization: every replacement bridge performs a fresh authorized health request with its own live URL and token before shell validation can be reused.

`desktopSessionTransport` resolves the immutable transport kind, base URL, entry URL, display URL, navigation boundary, proxy policy, and partition before a session window exists. Native Local Environment, SSH/container placement, and Gateway loopback sessions use session-scoped non-persistent Electron partitions configured with `setProxy({ mode: 'direct' })` before the first load. Root, child, access-gate, and codespace windows share that partition, and session closure clears its storage. Provider remote and external Local UI sessions continue to use the default Session and system proxy policy.

WebRequest diagnostics are installed idempotently for every Electron Session that Desktop uses. An opening root document with final HTTP status 400 or greater fails immediately with transport and status diagnostics; Chromium failures remain immediate through `did-fail-load`. The readiness timeout is reserved for a loaded document that never reports an interactive password gate or connected Runtime state. Renderer projections, Welcome snapshots, persisted preferences, and user diagnostics omit both private bridge fields. The main process projects only `desktop_private_bridge_v2` through the session-context preload for private documents. Env App selects `flowersec-private-loopback/1` only with that exact provenance. Public HTTP uses the separate released HTTPDirect profile; public HTTPS retains normal `flowersec/3` WSS. Placement HTTP/2 is outside Flowersec and cannot weaken its admission, lease, or E2EE rules. [Local UI network exposure](../security/local-ui-network-exposure.md) owns these protocol boundaries.

# Boundaries

Runtime-control is a local Desktop coordination capability, not a general network API or plugin grant plane. Bridge, health, process, Gateway, Provider, and session observations must not become competing lifecycle authorities. Desktop must not log or project the bridge token, attach it to a public origin, change the system proxy, modify system-wide trust, add VPN/private-range bypass tables, globally disable proxying, or recover a missing authorized bridge by selecting a public address. Certificate creation and current-user trust installation occur only through explicit settings actions calling the bundled maintenance CLI. The private Flowersec profile cannot become a Provider, Gateway, URL, or public-browser fallback. ReDevPlugin and access components retain their separate execution boundaries.

# Evidence

- `redeven:desktop/src/main/desktopCertificate.test.ts` - Exercises explicit setup, preserved identity after trust failure, verification, and HTTPS restart admission.
- `redeven:desktop/src/welcome/LocalCertificateSettings.client.test.tsx` - Covers legacy trust status, actionable retries, duplicate actions, and stale environment responses.
- `redeven:desktop/src/welcome/LocalEnvironmentSettingsDialog.client.test.tsx` - Verifies live snapshot updates preserve expanded sections, scroll, focused input selection, and drafts without restarting certificate checks.
- `redeven:desktop/src/main/desktopPreferences.test.ts` - Loads existing catalogs without a protocol into HTTP startup while preserving the saved port, password, and explicit HTTPS choice.
- `redeven:cmd/redeven/main.go:299` - Local Desktop startup is rejected for remote-only mode.
- `redeven:desktop/src/main/localUIURL.ts:44` - Desktop builds the Env App entry URL under `/_redeven_proxy/env/`.
- `redeven:cmd/redeven/desktop_launch_report.go:123` - Ready and attached private reports require and validate the trusted bridge URL.
- `redeven:internal/localui/localui.go:417` - Runtime starts a separate ephemeral loopback listener for trusted Desktop transport.
- `redeven:desktop/src/main/desktopSessionTransport.ts:1` - Desktop resolves transport, display, proxy, and partition state through one contract.
- `redeven:desktop/src/main/runtimeState.ts:1` - Private bridge probes keep live authorization separate from target-scoped shell integrity reuse.
- `redeven:desktop/src/main/runtimePlacementBridgeSession.ts:555` - One stdio-backed HTTP/2 session owns control requests, CONNECT streams, liveness, and recovery.
- `redeven:internal/desktopbridge/server.go:26` - Runtime serves the private HTTP/2 connection directly on bridge stdio.
- `redeven:desktop/src/main/main.ts:8222` - Session creation prepares direct Electron proxy state before loading Desktop-owned loopback transport.
- `redeven:desktop/src/main/main.ts:16928` - Per-Session diagnostics fail opening root documents on final HTTP errors.
- `redeven:okf/desktop/desktop-runtime-process-lifecycle.md:1` - Runtime process inventory and lifecycle ordering are maintained as a separate Desktop contract.
- `redeven:desktop/src/main/main.ts:8854` - Welcome Flower cold-starts Local Environment through structured local Runtime lifecycle progress.
