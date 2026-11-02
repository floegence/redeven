from pathlib import Path
import json
import os
import subprocess
import sys
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

    def test_main_dependencies_check_notices_and_propagate_staleness(self):
        # Run the real group dispatcher in an isolated repository with probes;
        # this does not run the product's main push gate or install dependencies.
        env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "LOCAL_GATE_"))}
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=self.root, env=env, text=True).strip()
        git("init", "-q", "-b", "main")
        git("config", "user.name", "Gate Test")
        git("config", "user.email", "gate@invalid.example")
        binary = self.root / "bin/node"
        binary.parent.mkdir()
        binary.write_text(
            f"#!{sys.executable}\n"
            "import json, os, pathlib, sys\n"
            "if sys.argv[1:] == ['scripts/generate_third_party_notices.mjs', '--check']:\n"
            "    pathlib.Path('.git/notices-probe.json').write_text(json.dumps({'args': sys.argv[1:], 'gowork': os.environ.get('GOWORK')}))\n"
            "    sys.exit(int(os.environ['TEST_NOTICES_STATUS']))\n"
        )
        binary.chmod(0o755)
        for name in ["test_generate_release_notes.sh", "check_runtime_compatibility_contract.sh", "check_redevplugin_dependency_boundary.sh"]:
            script = self.root / "scripts" / name
            script.write_text("#!/usr/bin/env bash\nexit 0\n")
            script.chmod(0o755)
        git("add", ".")
        git("commit", "-qm", "initial")
        tip = git("rev-parse", "HEAD")
        env.update(PATH=str(binary.parent) + os.pathsep + env["PATH"], LOCAL_GATE_ACTIVE="1", LOCAL_GATE_BASE=tip, GOWORK="unexpected-workspace")
        probe = self.root / ".git/notices-probe.json"
        for status in (0, 29):
            with self.subTest(notices_status=status):
                probe.unlink(missing_ok=True)
                result = subprocess.run(
                    ["bash", "scripts/check_final_integration.sh", "--group", "dependencies"],
                    cwd=self.root, env={**env, "TEST_NOTICES_STATUS": str(status)}, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, status, result.stdout + result.stderr)
                self.assertTrue(probe.exists(), "main dependency gate must verify third-party notices")
                self.assertEqual(json.loads(probe.read_text()), {"args": ["scripts/generate_third_party_notices.mjs", "--check"], "gowork": "off"})
                if status:
                    self.assertNotIn("final integration gate passed", result.stdout)
                self.assertEqual(git("status", "--porcelain"), "")


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
