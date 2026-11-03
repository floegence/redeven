#!/usr/bin/env python3
"""Verify the exact product-owned hardened signature on the Wasm runtime."""

import plistlib
import re
import subprocess
import sys

EXPECTED_ENTITLEMENTS = {
    "com.apple.security.cs.allow-unsigned-executable-memory": True,
}


def run_codesign(*args):
    return subprocess.run(
        ["codesign", *args], check=True, capture_output=True, timeout=30
    )


def verify(runtime):
    run_codesign("--verify", "--strict", "--verbose=2", runtime)
    details = run_codesign("--display", "--verbose=4", runtime)
    match = re.search(rb"\bflags=0x([0-9a-fA-F]+)\b", details.stderr)
    if match is None or int(match.group(1), 16) & 0x10000 == 0:
        raise ValueError("ReDevPlugin runtime signature must enable hardened runtime")
    signed = run_codesign("--display", "--entitlements", "-", "--xml", runtime)
    entitlements = plistlib.loads(signed.stdout)
    if not isinstance(entitlements, dict) or entitlements != EXPECTED_ENTITLEMENTS:
        raise ValueError("ReDevPlugin runtime signature has unexpected entitlements")
    if entitlements["com.apple.security.cs.allow-unsigned-executable-memory"] is not True:
        raise ValueError("ReDevPlugin runtime executable-memory entitlement must be true")


def main():
    if len(sys.argv) != 2:
        raise ValueError("usage: verify_redevplugin_macos_signature.py <runtime>")
    verify(sys.argv[1])


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError, plistlib.InvalidFileException) as error:
        print(f"[redevplugin-signature] {error}", file=sys.stderr)
        sys.exit(1)
