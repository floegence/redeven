import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ENGINE = Path(__file__).resolve().parents[1] / "local_gate.py"


class LocalGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="local-gate-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.root.mkdir()
        self.env = dict(os.environ)
        for key in list(self.env):
            if key.startswith(("GIT_", "LOCAL_GATE_")) or key == "CI":
                self.env.pop(key)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Gate Test")
        self.git("config", "user.email", "gate@invalid.example")
        (self.root / "scripts").mkdir()
        (self.root / "scripts/local_gate.py").write_bytes(ENGINE.read_bytes())
        (self.root / ".gitignore").write_text("trace\nfail-*\nwait-*\nready-*\nenvironment\n")
        (self.root / "source").write_text("original\n")
        (self.root / "scripts/group.py").write_text(
            "import pathlib,sys,time\n"
            "name=sys.argv[1]\n"
            "with pathlib.Path('trace').open('a') as f: f.write(name+'\\n')\n"
            "pathlib.Path('ready-'+name).touch()\n"
            "while pathlib.Path('wait-'+name).exists(): time.sleep(.02)\n"
            "if pathlib.Path('fail-'+name).exists(): sys.exit(7)\n"
        )
        self.manifest = {
            "profiles": {"full": list("ABCDE"), "commit": list("AB")},
            "groups": [{"id": name, "command": [sys.executable, "scripts/group.py", name]} for name in "ABCDE"],
        }
        self.write_manifest()
        self.git("add", ".")
        self.git("commit", "-qm", "initial")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], env=self.env, text=True).strip()

    def write_manifest(self):
        (self.root / "scripts/local_gate_groups.json").write_text(json.dumps(self.manifest))

    def gate(self, *args, expected=0):
        result = subprocess.run([sys.executable, "scripts/local_gate.py", *args], cwd=self.root, env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout

    def state(self):
        return json.loads((self.root / ".git/local-gate/state.json").read_text())

    def trace(self):
        path = self.root / "trace"
        return path.read_text().splitlines() if path.exists() else []

    def clear_trace(self):
        (self.root / "trace").write_text("")

    def start(self):
        return subprocess.Popen([sys.executable, "scripts/local_gate.py"], cwd=self.root, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)

    def wait_ready(self, name, process):
        until = time.monotonic() + 10
        while time.monotonic() < until:
            if (self.root / ("ready-" + name)).exists():
                return
            if process.poll() is not None:
                self.fail(process.communicate()[0])
            time.sleep(.02)
        self.fail("group did not initialize")

    def test_manual_staged_commit_and_push_reuse_the_same_tree(self):
        (self.root / "source").write_text("changed\n")
        self.gate()
        tree = self.state()["rounds"]["full"]["tree"]
        self.git("add", ".")
        output = self.gate("--mode", "staged")
        self.assertEqual(output.count("SKIP "), 5)
        self.git("commit", "-qm", "validated")
        self.gate("associate")
        commit = self.git("rev-parse", "HEAD")
        self.assertEqual(self.state()["commits"][commit]["tree"], tree)
        self.assertEqual(self.gate("--mode", "committed", "--tip", commit).count("SKIP "), 5)
        self.assertEqual(self.trace(), list("ABCDE"))

    def test_working_source_cannot_be_misattributed_to_staged_tree(self):
        (self.root / "source").write_text("unstaged\n")
        self.assertIn("differs from the staged", self.gate("--mode", "staged", expected=1))
        self.assertEqual(self.trace(), [])

    def test_failure_resume_rotates_and_reuses_valid_passes(self):
        (self.root / "fail-C").touch()
        self.gate(expected=7)
        self.assertEqual(self.trace(), list("ABC"))
        self.assertEqual(self.state()["cursors"]["full"], "C")
        (self.root / "fail-C").unlink()
        self.clear_trace()
        output = self.gate()
        self.assertEqual(self.trace(), list("CDE"))
        self.assertEqual(output.count("SKIP "), 2)
        self.assertEqual(self.state()["rounds"]["full"]["tree"], self.git("rev-parse", "HEAD^{tree}"))

    def test_failure_cursor_is_shared_between_manual_and_hook_profiles(self):
        self.manifest["profiles"]["commit"] = list("ABCDE")
        self.write_manifest()
        (self.root / "fail-C").touch()
        self.gate(expected=7)
        (self.root / "fail-C").unlink()
        self.clear_trace()
        output = self.gate("--profile", "commit")
        self.assertIn("cursor=C", output)
        self.assertEqual(self.trace(), list("CDE"))

    def test_changed_input_invalidates_passes_but_keeps_failure_cursor(self):
        (self.root / "fail-C").touch()
        self.gate(expected=7)
        (self.root / "fail-C").unlink()
        (self.root / "source").write_text("new version\n")
        self.clear_trace()
        self.assertIn("source", self.gate())
        self.assertEqual(self.trace(), list("CDEAB"))

    def test_environment_invalidation_only_affects_owning_group(self):
        self.manifest["groups"][2]["environment"] = {"paths": ["environment"]}
        self.write_manifest()
        self.gate()
        self.clear_trace()
        (self.root / "environment").write_text("new environment")
        output = self.gate()
        self.assertEqual(self.trace(), ["C"])
        self.assertIn("INVALIDATE C: environment", output)

    def test_test_and_dependency_configuration_changes_invalidate(self):
        self.gate()
        for name in ("scripts/group.py", "package-lock.json", "config.json"):
            self.clear_trace()
            path = self.root / name
            path.write_text(path.read_text() + "\n" if path.exists() else "{}\n")
            self.gate()
            self.assertEqual(self.trace(), list("ABCDE"), name)

    @unittest.skipIf(os.name == "nt", "POSIX process qualification")
    def test_interruption_does_not_record_a_pass_and_resumes(self):
        (self.root / "wait-C").touch()
        process = self.start()
        self.wait_ready("C", process)
        process.send_signal(signal.SIGTERM)
        output = process.communicate(timeout=10)[0]
        self.assertEqual(process.returncode, 130, output)
        self.assertEqual(self.state()["groups"]["C"]["status"], "interrupted")
        (self.root / "wait-C").unlink()
        self.clear_trace()
        self.gate()
        self.assertEqual(self.trace(), list("CDE"))

    @unittest.skipIf(os.name == "nt", "POSIX process qualification")
    def test_abrupt_death_leaves_running_cursor_and_recovers(self):
        (self.root / "wait-C").touch()
        process = self.start()
        self.wait_ready("C", process)
        child = subprocess.check_output(["pgrep", "-P", str(process.pid)], text=True).splitlines()
        process.kill()
        for pid in child:
            os.killpg(int(pid), signal.SIGKILL)
        process.communicate(timeout=10)
        self.assertEqual(self.state()["groups"]["C"]["status"], "running")
        (self.root / "wait-C").unlink()
        self.clear_trace()
        self.assertIn("interrupted attempt", self.gate())
        self.assertEqual(self.trace(), list("CDE"))

    @unittest.skipIf(os.name == "nt", "POSIX process qualification")
    def test_concurrent_runner_fails_without_overwriting_state(self):
        (self.root / "wait-A").touch()
        process = self.start()
        self.wait_ready("A", process)
        before = self.state()
        self.assertIn("repository lock", self.gate(expected=1))
        self.assertEqual(self.state(), before)
        (self.root / "wait-A").unlink()
        self.assertEqual(process.communicate(timeout=10)[0].count("COMPLETE "), 1)

    def test_force_runs_every_group_from_the_beginning(self):
        self.gate()
        self.clear_trace()
        output = self.gate("--force")
        self.assertEqual(self.trace(), list("ABCDE"))
        self.assertIn("FORCE full rerun", output)
        self.assertNotIn("SKIP ", output)

    def test_source_mutation_during_group_cannot_pass(self):
        self.manifest["groups"][0]["command"] = [sys.executable, "-c", "from pathlib import Path; Path('source').write_text('mutated')"]
        self.write_manifest()
        self.gate(expected=1)
        self.assertEqual(self.state()["groups"]["A"]["status"], "failed")
        self.assertNotIn("full", self.state()["rounds"])

    def test_changed_environment_during_test_cannot_pass(self):
        self.manifest["groups"][0]["environment"] = {"paths": ["environment"]}
        self.manifest["groups"][0]["command"] = [sys.executable, "-c", "from pathlib import Path; Path('environment').write_text('mutated')"]
        self.write_manifest()
        self.assertIn("environment changed while testing", self.gate(expected=1))

    def test_initialization_is_measured_before_testing_and_reused(self):
        self.manifest["groups"][0]["environment"] = {"paths": ["environment"]}
        self.manifest["groups"][0]["prepare"] = [sys.executable, "-c", "from pathlib import Path; Path('environment').write_text('initialized')"]
        self.write_manifest()
        self.gate()
        self.clear_trace()
        self.assertNotIn("PREPARE ", self.gate())
        self.assertEqual(self.trace(), [])

    def test_corrupt_state_fails_closed_and_revalidates(self):
        self.gate()
        (self.root / ".git/local-gate/state.json").write_text("{partial")
        self.clear_trace()
        self.assertIn("unreadable", self.gate())
        self.assertEqual(self.trace(), list("ABCDE"))

    def test_atomic_write_failure_preserves_previous_record(self):
        spec = importlib.util.spec_from_file_location("gate_engine", ENGINE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        target = Path(self.temp.name) / "state.json"
        module.atomic_write(target, {"previous": True})
        with patch.object(module.os, "replace", side_effect=OSError("interrupted replace")):
            with self.assertRaises(OSError):
                module.atomic_write(target, {"passed": True})
        self.assertEqual(json.loads(target.read_text()), {"previous": True})
        self.assertEqual(list(target.parent.glob("state-*.tmp")), [])

    def test_ci_never_accepts_a_local_cached_pass(self):
        self.gate()
        self.clear_trace()
        self.env["CI"] = "1"
        output = self.gate()
        self.assertEqual(self.trace(), list("ABCDE"))
        self.assertNotIn("SKIP ", output)


if __name__ == "__main__":
    unittest.main()
