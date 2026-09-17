#!/usr/bin/env python3
"""Serialize the complete Env App asset build within one checkout."""

import fcntl
import os
from pathlib import Path
import shutil


def main():
    package_root = Path(__file__).resolve().parent.parent
    os.chdir(package_root)
    lock_path = package_root / "node_modules/.cache/redeven-envapp-build.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("Waiting for the current Env App asset build to finish...", flush=True)
        fcntl.flock(descriptor, fcntl.LOCK_EX)

    # The shell and its children retain the kernel lock until they exit, including
    # failures or signals. Never unlink the lock file while another builder waits.
    os.set_inheritable(descriptor, True)
    cache = package_root / "node_modules/.vite"
    if cache.exists():
        shutil.rmtree(cache)
    os.execvp("sh", ["sh", "-ec", (
        "tsc -p tsconfig.json && vite build "
        "&& node scripts/checkInitialBuildBudget.mjs "
        "&& node scripts/precompressAssets.mjs"
    )])


if __name__ == "__main__":
    main()
