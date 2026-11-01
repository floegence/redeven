---
type: Acceptance Record
title: Wayland capture pool optimization evidence
tags: [desktop, linux, wayland, validation, latency]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native 0.22.14 replaces full-frame copies with a bounded pool.36 native tests pass. Alternating udesk24 synthetic 1440p60/x264 improves encoded 46.86–48.06→59.90 FPS and capture 19.34–19.96→2.64–2.79 ms; paint ACK improves too. This is not live GNOME or physical-input certification.

# Contract

Retain cursor/pixel lifetime, final-frame recovery and interruptible shutdown. [Media](../architecture/remote-desktop-media.md) owns current behavior; original ec0d9cc8 source/tables remain in Git.

# Boundaries

Synthetic headless/SSH results cannot certify the slower live GNOME workload. Weak-VM performance remains observational; integration never authorizes screen sharing.

# Evidence

- Published `floe-native-apps` `host_desktop_pixels.py`, `host_desktop_pipewire.py` and `host_desktop_media.py`: authoritative pixel ownership and encoder lease implementation.

- Published `qualification/host_desktop_pixels.py` and `qualification/host_desktop_pipewire.py`: installed native lifetime, format, cursor and memory-path checks.

- [Release qualification 37320233514](https://github.com/floegence/floe-native-apps/actions/runs/37320233514): both native host-desktop architectures, macOS library and distribution status.
