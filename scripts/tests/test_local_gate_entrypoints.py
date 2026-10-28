from pathlib import Path
import json
import subprocess
import tempfile
import unittest


class IntegrationEntryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gate-entry-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        scripts = self.root / "scripts"
        scripts.mkdir()
        source = Path(__file__).resolve().parents[1]
        (scripts / "check_final_integration.sh").write_bytes((source / "check_final_integration.sh").read_bytes())
        (scripts / "local_gate.py").write_text("import json,sys\nprint(json.dumps(sys.argv[1:]))\n")

    def test_manual_exact_main_entry_passes_original_context_to_runner(self):
        result = subprocess.run(["bash", "scripts/check_final_integration.sh", "--base", "base", "--tip", "tip"], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ["--profile", "full", "--mode", "committed", "--base", "base", "--tip", "tip"])

    def test_force_flag_survives_the_manual_and_push_wrapper(self):
        result = subprocess.run(["bash", "scripts/check_final_integration.sh", "--base", "base", "--tip", "tip", "--force"], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[-1], "--force")

    def test_missing_exact_main_context_is_rejected(self):
        result = subprocess.run(["bash", "scripts/check_final_integration.sh"], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)


    def test_ordinary_profiles_exclude_long_thread_qualification(self):
        # Exercise the actual manifest/runner in a temporary repository.
        # Ordinary commands are harmless probes; no product push gate runs.
        import os
        source = Path(__file__).resolve().parents[1]
        env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "LOCAL_GATE_"))}
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=self.root, env=env, text=True).strip()
        git("init", "-q", "-b", "main")
        git("config", "user.name", "Gate Test")
        git("config", "user.email", "gate@invalid.example")
        (self.root / "scripts/local_gate.py").write_bytes((source / "local_gate.py").read_bytes())
        manifest = json.loads((source / "local_gate_groups.json").read_text())
        for groups in manifest["profiles"].values():
            self.assertTrue(all(not group.startswith("flower-long-thread") for group in groups))
        manifest["environment"] = {}
        for group in manifest["groups"]:
            self.assertFalse(group["id"].startswith("flower-long-thread"))
            self.assertFalse(any("flower_long_thread" in arg or "flower-long-thread" in arg for arg in group["command"]))
            group.pop("environment", None)
            group["command"] = ["python3", "-c", "pass"]
        (self.root / "scripts/local_gate_groups.json").write_text(json.dumps(manifest))
        git("add", ".")
        git("commit", "-qm", "initial")
        tip = git("rev-parse", "HEAD")
        for profile, mode in [("commit", "staged"), ("full", "committed")]:
            result = subprocess.run(["python3", "scripts/local_gate.py", "--profile", profile, "--mode", mode, "--base", tip, "--tip", tip], cwd=self.root, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = json.loads((self.root / ".git/local-gate/state.json").read_text())
        self.assertEqual(set(state["rounds"]), {"commit", "full"})
        self.assertEqual(set(state["groups"]), {group for groups in manifest["profiles"].values() for group in groups})


if __name__ == "__main__":
    unittest.main()
