from pathlib import Path
import subprocess
import unittest

import test_local_gate as fixtures


class ActualHookTests(unittest.TestCase):
    git = fixtures.LocalGateTests.git
    write_manifest = fixtures.LocalGateTests.write_manifest
    gate = fixtures.LocalGateTests.gate
    state = fixtures.LocalGateTests.state
    trace = fixtures.LocalGateTests.trace

    def setUp(self):
        fixtures.LocalGateTests.setUp(self)
        self.remote = Path(self.temp.name) / "remote.git"
        subprocess.run(["git", "init", "--bare", "-q", str(self.remote)], check=True, env=self.env)
        self.git("remote", "add", "origin", str(self.remote))
        self.git("push", "-q", "origin", "main")
        source = Path(__file__).resolve().parents[2]
        hooks = self.root / ".githooks"
        hooks.mkdir()
        for name in ("pre-commit", "post-commit", "pre-push"):
            (hooks / name).write_bytes((source / ".githooks" / name).read_bytes())
            (hooks / name).chmod(0o755)
        self.manifest["profiles"]["commit"] = list("ABCDE")
        self.write_manifest()
        (self.root / "scripts/check_final_integration.sh").write_text(
            '#!/usr/bin/env bash\nset -euo pipefail\n'
            'exec python3 scripts/local_gate.py --profile full --mode committed --base "$2" --tip "$4"\n'
        )
        (self.root / "scripts/check_final_integration.sh").chmod(0o755)
        self.git("add", ".")
        self.git("commit", "-qm", "install fixtures")
        self.git("push", "-q", "origin", "main")
        self.git("config", "core.hooksPath", ".githooks")

    def test_real_hooks_deduplicate_manual_commit_and_push(self):
        (self.root / "source").write_text("hook qualification\n")
        self.git("add", ".")
        self.gate("--mode", "staged")
        self.git("commit", "-qm", "same tested tree")
        head = self.git("rev-parse", "HEAD")
        self.assertEqual(self.state()["commits"][head]["tree"], self.git("rev-parse", "HEAD^{tree}"))
        self.git("push", "-q", "origin", "main")
        self.assertEqual(self.trace(), list("ABCDE"))
        self.assertEqual(self.git("rev-parse", "main"), self.git("rev-parse", "origin/main"))

    def test_real_commit_hook_rejects_partial_staging(self):
        (self.root / "source").write_text("staged version\n")
        self.git("add", ".")
        (self.root / "source").write_text("different working source\n")
        result = subprocess.run(["git", "commit", "-qm", "must not commit"], cwd=self.root, env=self.env, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("differs from the staged Git tree", result.stdout + result.stderr)
        self.assertEqual(self.trace(), [])


if __name__ == "__main__":
    unittest.main()
