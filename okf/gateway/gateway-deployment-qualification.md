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

The Gateway contract-alignment pass on 2026-11-02 verified Desktop connection IDs independently of signed service IDs, Cloud-independent Runtime management, public/private permission boundaries and ambiguous-attachment rejection. Published Flowersec 5.11.1 and ReDevPlugin 3.13.0 already provide the owning transport contracts; this pass changes Redeven adapters only, without dependency overrides. The regular Desktop suite passed 4,403 tests with two pre-existing skips, and the client suite passed 578 tests. Real Desktop setup passed 16 cases (including rejected permission injection, explicit host authorization, restart persistence and retained service data); empty-address enrollment passed seven cases with real Runtime consent. Both suites verified owned cleanup. The actual Gateway application fixture, three Center browser engines, isolated egress, local/SSH/container hosts, network restart and failed-update preservation passed again. These checks do not certify installers, Windows/WSL deployment or production Cloud.

On 2026-11-02 the independent implementation passed the real Electron 13-case application fixture, all three Web Center browser engines, isolated Docker egress, 40 Gateway management locale/viewport cases, all four local/SSH/container host placements, and real network-settings restart. The rendered Nginx stream template passed nginx -t. Runtime owner-page browser acceptance also covers preparing a Gateway route before Cloud enrollment. The optional plugin qualification also passed all 20 combined Electron cases on the integrated plugin-authoring branch, with owned-process cleanup verified. These are source-build results, not installer or production-Cloud certification. The final affected checks must be rerun after substantive changes.

- redeven:internal/localui/gateway_member_browser_test.go — Production no-inbound-Runtime application fixture.
- redeven:desktop/scripts/fixtures/gateway-access-electron.ts — Real Electron access assertions and owned cleanup.
- redeven:internal/localui/center_browser_test.go — Web Center browser qualification.
- redeven:desktop/scripts/check-gateway-management-ui.mjs — Multilingual management qualification.
