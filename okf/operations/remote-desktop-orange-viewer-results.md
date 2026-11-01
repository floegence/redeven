---
type: Qualification Record
title: Orange remote desktop Viewer follow-up
tags: [desktop, ssh, deployment, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Orange 0.22.37 passes thirteen release jobs and Viewer Unicode/lock/unlock/input/media checks. Mac Pinyin is deferred; host Pinyin unvalidated. Improved paired latency/FPS does not erase missing idle responses/SSH recovery failures or later RustDesk tails/disconnects; measured LAN loss limits comparison.

# Contract

Task consumer bb6683b5ce18/GOWORK=off. b7d994aff911 repairs Node 26 linked-entry verification,31checks pass; missing published MPP assets still block setup while old service works. Bounded paste respects authority.

# Boundaries

[Comparison](remote-desktop-rustdesk-comparison-results.md) and [deployment](../architecture/remote-desktop-ssh-deployment.md) own remaining qualification. Orange proves no hardware-wide parity; Git retains task IDs/failures.

# Evidence

- `scripts/redevplugin_release_contract.mjs` and tests: linked CLI execution and release verification.

- `desktop/src/main/sshRuntime.ts` and `remoteDesktopDeployment.ts`: normal update and Env App admission.

- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: lock authority, recovery and bounded paste.
