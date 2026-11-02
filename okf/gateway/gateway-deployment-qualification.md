---
type: Gateway Contract
title: Independent Gateway qualification
tags: [gateway, validation, networking]
lifecycle: active_evidence
reviewed_at: "2026-11-02"
---
# Summary

Affected-feature acceptance must exercise fresh independent device admission, real application authentication and exact revocation scope. These checks are separate from the aggregate main push gate and release packaging.

# Contract

## Product paths
scripts/check_gateway_access_browser.sh starts the production public Gateway and Runtime handlers with no Runtime inbound TCP listener or Cloud credentials. A real Electron client pairs through the advertised HTTPS endpoint using scoped trust, then exercises password, MFA/recovery, files, terminal, CodeSpace edit/save, cookies, service forwarding and inner certificate rejection. The editor fixture waits for focus in the document editor and verifies inserted document text before saving, so a chat input cannot satisfy the edit step. Setting REDEVEN_PLUGIN_WEB_QUALIFICATION=1 adds seven published Web plugin cases covering direct private resources, conditional writes, binary files, isolation and Surface lifetimes.

scripts/check_center.sh --browser exercises the actual Web Center UI in Chromium, Firefox and WebKit: single-administrator entry setup, fresh Gateway pairing, owner-approved Runtime bindings, real terminal/files/Git/editor/services, origin boundaries and independent device/Runtime/Gateway revocation. The fixture uses the same unified Gateway public listener, not a private-handler TCP shortcut. Setup recovery assertions wait for the visible sign-in transition after commit before reading delivery counts, including WebKit.

scripts/check_gateway_cloud_isolation.sh creates task-owned isolated Docker networks. Runtime cannot reach Cloud IPs, public routing or public DNS. Local Gateway egress policy alone admits authenticated inner HTTPS and Flowersec RPC. No Gateway Cloud identity exists. Fixture-only private destinations are explicit; product destination safety remains enabled.

## Presentation and state
Gateway management qualification covers ten locales at 390, 430, 768 and 1280 pixels, explicit issuance, preserved drafts, revocation, keyboard menus and active-only scroll extent. Focused contracts verify wrong-purpose/expired trust packages, public management rejection, read-only old-state rejection, persisted connection migration and operation recovery.

# Evidence

The authority-convergence pass on 2026-11-02 uses published Flowersec 5.11.1 connection snapshots, typed failures, session cancellation and graceful shutdown. These contracts already cover the shared mechanics, so changes stay in Redeven adapters and owned state; there are no dependency overrides, sibling-source imports or copied upstream implementations.

The affected Go packages and focused race checks pass. Desktop typecheck, build and changed-source lint pass; its regular suite passes 4,404 tests with two existing skips, and its client suite passes 584 tests. Regression coverage includes identity-preserving trust schemas 1–3 to 4, revoked-key non-resurrection, exact client stream/ticket revocation, independent private host recovery, malformed signatures, real collection observations, stopped CLI state and separate Cloud consent. The DNS reconnect fixture drains callbacks with SDK Shutdown; ten repeated reconnect runs pass without temporary-store cleanup races.

Source-build acceptance passes the 13-case real Electron application fixture, all three Web Center browser engines, isolated Docker egress and all four local/SSH/container host placements. Production Desktop setup passes 20 cases, including current-device revocation, refresh without implicit reauthorization, explicit fresh-key recovery, restart persistence and owned cleanup. Gateway management passes 40 locale/viewport cases including current-device recovery; authentication passes 37, network presentation 28, independent Cloud consent 11 and state recovery two. Runtime connection acceptance passes 135 cases across English, Simplified Chinese and German at narrow and wide viewports. The current-device German narrow layout and Chinese enrollment layout were visually reviewed.

These results certify the exercised source-build paths, not installers, native Windows/WSL deployment or production Cloud. Main push qualification is intentionally excluded from this local-only delivery.

- redeven:internal/localui/gateway_member_browser_test.go — Production no-inbound-Runtime application fixture.
- redeven:desktop/scripts/fixtures/gateway-access-electron.ts — Real Electron access assertions and owned cleanup.
- redeven:internal/localui/center_browser_test.go — Web Center browser qualification.
- redeven:desktop/scripts/check-gateway-management-ui.mjs — Multilingual management qualification.
