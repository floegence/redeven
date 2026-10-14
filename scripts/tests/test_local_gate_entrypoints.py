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


if __name__ == "__main__":
    unittest.main()
