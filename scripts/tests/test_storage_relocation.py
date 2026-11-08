import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('relocate', Path(__file__).parents[1] / 'relocate_prerelease_storage.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class RelocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.state = self.root / 'environment'
        self.state.mkdir()

    def check_plugins(self):
        return subprocess.run([sys.executable, str(Path(m.__file__)), '--state-dir', str(self.state), '--check-plugins'], capture_output=True, text=True)

    def test_startup_preflight_accepts_fresh_profile_without_writing(self):
        self.state.rmdir()
        result = self.check_plugins()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.state.exists())

    def test_startup_preflight_rejects_retained_plugins_with_recovery_command(self):
        (self.state / 'control.sqlite').write_bytes(b'retained opaque state')
        result = self.check_plugins()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--relocate-storage', result.stderr)
        self.assertEqual((self.state / 'control.sqlite').read_bytes(), b'retained opaque state')
        self.assertFalse((self.state / m.MARKER).exists())

    def test_startup_preflight_rejects_incomplete_relocation_and_accepts_completion(self):
        (self.state / 'control.sqlite').write_bytes(b'opaque state')
        m.save(self.state / m.MARKER, m.plan(self.state))
        self.assertNotEqual(self.check_plugins().returncode, 0)
        m.relocate(self.state, apply=True)
        self.assertEqual(self.check_plugins().returncode, 0)

    def test_startup_preflight_rejects_placement_alias_without_following_it(self):
        target = self.root / 'external'; target.mkdir()
        (self.state / 'apps').symlink_to(target)
        self.assertNotEqual(self.check_plugins().returncode, 0)
        self.assertEqual(list(target.iterdir()), [])

    def test_startup_preflight_rejects_invalid_journal_without_traceback(self):
        (self.state / m.MARKER).write_text('[]')
        result = self.check_plugins()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--relocate-storage', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assertEqual((self.state / m.MARKER).read_text(), '[]')

    def test_startup_preflight_rejects_special_journal_without_reading_it(self):
        os.mkfifo(self.state / m.MARKER)
        result = subprocess.run([sys.executable, str(Path(m.__file__)), '--state-dir', str(self.state), '--check-plugins'], capture_output=True, text=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('invalid storage relocation journal', result.stderr)

    def test_startup_preflight_rejects_orphan_sidecars_without_writing(self):
        (self.state / 'control.sqlite-wal').write_bytes(b'opaque orphan')
        self.assertNotEqual(self.check_plugins().returncode, 0)
        self.assertFalse((self.state / m.MARKER).exists())

    def test_nested_dependency_links_fail_without_mutating_retained_state(self):
        source = self.state / 'author-workspaces/projects/example/source/node_modules'
        (source / '.bin').mkdir(parents=True)
        (source / 'tool.js').write_bytes(b'retained dependency')
        (source / '.bin/tool').symlink_to('../tool.js')
        (self.state / 'control.sqlite').write_bytes(b'retained control state')
        with self.assertRaisesRegex(ValueError, 'unsupported filesystem entry'):
            m.relocate(self.state, apply=True)
        self.assertEqual((source / '.bin/tool').readlink(), Path('../tool.js'))
        self.assertEqual((source / 'tool.js').read_bytes(), b'retained dependency')
        self.assertEqual((self.state / 'control.sqlite').read_bytes(), b'retained control state')
        self.assertFalse((self.state / m.MARKER).exists())
        self.assertFalse((self.state / 'apps/plugins/platform').exists())

    def test_opaque_sqlite_and_sidecars_move_without_interpretation(self):
        for name in ['control.sqlite', 'control.sqlite-wal', 'secrets.sqlite']:
            (self.state / name).write_bytes(b'opaque upstream bytes')
        record = m.relocate(self.state)
        self.assertEqual(len(record['operations']), 3)
        self.assertFalse((self.state / m.MARKER).exists())
        m.relocate(self.state, apply=True)
        for name in ['control.sqlite', 'control.sqlite-wal', 'secrets.sqlite']:
            self.assertFalse((self.state / name).exists())
            self.assertEqual((self.state / 'apps/plugins/platform' / name).read_bytes(), b'opaque upstream bytes')
        self.assertEqual(m.relocate(self.state, apply=True)['status'], 'complete')

    def test_conflict_fails_before_any_moves(self):
        (self.state / 'control.sqlite').write_bytes(b'original')
        target = self.state / 'apps/plugins/platform'
        target.mkdir(parents=True)
        (target / 'control.sqlite').write_bytes(b'other')
        with self.assertRaises(ValueError): m.relocate(self.state, apply=True)
        self.assertEqual((self.state / 'control.sqlite').read_bytes(), b'original')
        self.assertFalse((self.state / m.MARKER).exists())

    def test_symlink_is_never_followed(self):
        external = self.root / 'external'; external.mkdir()
        (self.state / 'assets').symlink_to(external)
        with self.assertRaises(ValueError): m.relocate(self.state, apply=True)

    def test_live_runtime_lock_blocks_changes(self):
        (self.state / 'control.sqlite').write_bytes(b'original')
        with m.offline_lock(self.state):
            with self.assertRaises(BlockingIOError): m.relocate(self.state, apply=True)
        self.assertFalse((self.state / m.MARKER).exists())

    def test_skills_copy_preserves_shared_source_and_rewrites_product_metadata(self):
        source = self.root / 'skills'; source.mkdir()
        (source / 'example').mkdir(); skill = source / 'example/SKILL.md'; skill.write_text('Example')
        (self.state / 'skills_state.json').write_text(json.dumps({'schema_version':1, 'disabled_paths':[str(skill)]}))
        (self.state / 'skills_sources.json').write_text(json.dumps({'schema_version':1, 'items':[{'skill_path':str(skill),'source_id':'local:user:example','source_type':'local_manual'}]}))
        m.relocate(self.state, source, True)
        target = self.state / 'apps/skills/packages/example/SKILL.md'
        self.assertEqual(target.read_text(), skill.read_text())
        data = json.loads((self.state / 'apps/skills/state.json').read_text())
        self.assertEqual(data['disabled_paths'],[str(target)])

    def test_interrupted_moves_resume_exactly(self):
        (self.state / 'control.sqlite').write_bytes(b'control')
        (self.state / 'secrets.sqlite').write_bytes(b'secrets')
        rename = m.os.rename
        def fail_second(source, target):
            if source.name == 'secrets.sqlite': raise OSError('injected stop')
            return rename(source, target)
        with patch.object(m.os,'rename',fail_second):
            with self.assertRaises(OSError): m.relocate(self.state,apply=True)
        self.assertEqual(json.loads((self.state / m.MARKER).read_text())['status'],'pending')
        self.assertEqual(m.relocate(self.state,apply=True)['status'],'complete')

    def skill_fixture(self, source=None):
        source = source or self.root / 'skills'
        source.mkdir()
        skill = source / 'example/SKILL.md'
        skill.parent.mkdir(); skill.write_text('Retained skill')
        for name, content in [('skills_state.json', {'disabled_paths':[str(skill)]}), ('skills_sources.json', {'items':[{'skill_path':str(skill), 'source_id':'retained', 'source_type':'local_manual'}]})]:
            (self.state / name).write_text(json.dumps({'schema_version':1, **content}))
        return source, skill

    def test_explicit_missing_or_non_directory_source_fails_before_journal(self):
        (self.state / 'skills_state.json').write_text('{"schema_version":1,"disabled_paths":[]}')
        source = self.root / 'missing'
        for exists in [False, True]:
            if exists: source.write_text('not a directory')
            with self.assertRaisesRegex(ValueError, 'source directory required'): m.relocate(self.state, source, True)
            self.assertFalse((self.state / m.MARKER).exists())
            self.assertTrue((self.state / 'skills_state.json').exists())

    def test_ancestor_alias_preserves_disabled_and_source_decisions(self):
        original, _ = self.skill_fixture()
        alias = self.root / 'alias'; alias.symlink_to(self.root, target_is_directory=True)
        source = alias / original.name
        for name in ['skills_state.json', 'skills_sources.json']:
            path = self.state / name
            path.write_text(path.read_text().replace(str(original), str(source)))
        m.relocate(self.state, source, True)
        target = str(self.state / 'apps/skills/packages/example/SKILL.md')
        self.assertEqual(json.loads((self.state / 'apps/skills/state.json').read_text())['disabled_paths'], [target])
        self.assertEqual(json.loads((self.state / 'apps/skills/sources.json').read_text())['items'][0]['skill_path'], target)

    def test_journal_rejects_injected_metadata_and_changed_original(self):
        source, skill = self.skill_fixture()
        record = m.plan(self.state, source)
        marker = self.state / m.MARKER
        record['metadata'] = {'state.json': {'schema_version':1, 'disabled_paths':[]}}
        m.save(marker, record)
        with self.assertRaises(ValueError): m.relocate(self.state, source, True)
        del record['metadata']
        record['metadata_sources']['state.json']['bytes'] = m.base64.b64encode(b'{"schema_version":1,"disabled_paths":[]}').decode()
        m.save(marker, record)
        with self.assertRaisesRegex(ValueError, 'fingerprint'): m.relocate(self.state, source, True)
        self.assertEqual(json.loads((self.state / 'skills_state.json').read_text())['disabled_paths'], [str(skill)])
        self.assertFalse((self.state / 'apps/skills/packages').exists())

    def test_unplanned_metadata_is_rejected(self):
        source = self.root / 'skills'; source.mkdir()
        record = m.plan(self.state, source)
        record['metadata_sources'] = {'state.json': {'bytes':'e30=', 'mode':384}}
        m.save(self.state / m.MARKER, record)
        with self.assertRaisesRegex(ValueError, 'planned source'): m.relocate(self.state, source, True)

    def test_resume_after_one_metadata_publish_preserves_decisions(self):
        source, _ = self.skill_fixture()
        save = m.save
        def fail_sources(path, data):
            if path.name == 'sources.json': raise OSError('injected metadata stop')
            return save(path, data)
        with patch.object(m, 'save', fail_sources):
            with self.assertRaises(OSError): m.relocate(self.state, source, True)
        self.assertEqual(m.relocate(self.state, apply=True)['status'], 'complete')
        target = str(self.state / 'apps/skills/packages/example/SKILL.md')
        self.assertEqual(json.loads((self.state / 'apps/skills/state.json').read_text())['disabled_paths'], [target])
        self.assertEqual(json.loads((self.state / 'apps/skills/sources.json').read_text())['items'][0]['skill_path'], target)

    def test_partial_copy_is_retained_with_actionable_recovery(self):
        source, skill = self.skill_fixture()
        def fail_copy(src, dst, **kwargs):
            dst.mkdir(); (dst / 'partial').write_bytes(b'retained partial copy')
            raise OSError('injected copy stop')
        with patch.object(m.shutil, 'copytree', fail_copy):
            with self.assertRaises(OSError): m.relocate(self.state, source, True)
        with self.assertRaisesRegex(ValueError, 'move it outside this Environment without deleting'): m.relocate(self.state, source, True)
        stage = self.state / 'apps/skills/.packages-relocation'
        retained = self.root / 'inspected-partial-copy'
        stage.rename(retained)
        self.assertEqual(m.relocate(self.state, source, True)['status'], 'complete')
        self.assertEqual((retained / 'partial').read_bytes(), b'retained partial copy')
        self.assertEqual(skill.read_text(), 'Retained skill')

    def test_pending_or_complete_journal_never_ignores_new_explicit_source(self):
        source = self.root / 'skills'; source.mkdir()
        other = self.root / 'other'; other.mkdir()
        m.save(self.state / m.MARKER, m.plan(self.state, source))
        with self.assertRaisesRegex(ValueError, 'differs from journal'): m.relocate(self.state, other, True)
        m.relocate(self.state, source, True)
        with self.assertRaisesRegex(ValueError, 'differs from journal'): m.relocate(self.state, other, True)
        state = self.root / 'second-environment'; state.mkdir()
        m.relocate(state, apply=True)
        with self.assertRaisesRegex(ValueError, 'differs from journal'): m.relocate(state, source, True)
        self.assertFalse((state / 'apps/skills/packages').exists())

    def test_external_scope_alias_retains_independent_enablement(self):
        source, skill = self.skill_fixture()
        external = self.root / 'agents/skills'
        external.parent.mkdir(); external.symlink_to(source, target_is_directory=True)
        external_skill = str(external / 'example/SKILL.md')
        (self.state / 'skills_state.json').write_text(json.dumps({'schema_version':1, 'disabled_paths':[str(skill), external_skill]}))
        m.relocate(self.state, source, True)
        self.assertEqual(json.loads((self.state / 'apps/skills/state.json').read_text())['disabled_paths'], [str(self.state / 'apps/skills/packages/example/SKILL.md'), external_skill])

    def test_orphan_sqlite_sidecars_fail_before_any_move_or_completion(self):
        for suffix in ['-wal', '-shm', '-journal']:
            with self.subTest(suffix=suffix):
                state = self.root / ('orphan' + suffix); state.mkdir()
                sidecar = state / ('secrets.sqlite' + suffix)
                sidecar.write_bytes(b'retained transaction')
                with self.assertRaisesRegex(ValueError, 'orphan SQLite sidecar'): m.relocate(state, apply=True)
                self.assertFalse((state / m.MARKER).exists())
                self.assertEqual(sidecar.read_bytes(), b'retained transaction')
                record = {'version':1, 'state':str(state), 'status':'pending', 'operations':[{'source':sidecar.name, 'target':'apps/plugins/platform/' + sidecar.name, 'sha256':m.fingerprint(sidecar)}], 'skills':None, 'metadata_sources':{}}
                m.save(state / m.MARKER, record)
                with self.assertRaisesRegex(ValueError, 'orphan SQLite sidecar'): m.relocate(state, apply=True)
                self.assertEqual(sidecar.read_bytes(), b'retained transaction')
                self.assertEqual(json.loads((state / m.MARKER).read_text())['status'], 'pending')

    def test_unknown_sqlite_family_entries_block_preview_and_resume(self):
        for location in ['source', 'target']:
            for suffix in ['-wal', '-shm', '-journal']:
                with self.subTest(location=location, suffix=suffix):
                    state = self.root / (location + suffix); state.mkdir()
                    database = state / 'secrets.sqlite'; database.write_bytes(b'original database')
                    record = m.plan(state)
                    directory = state if location == 'source' else state / 'apps/plugins/platform'
                    directory.mkdir(parents=True, exist_ok=True)
                    sidecar = directory / ('secrets.sqlite' + suffix); sidecar.write_bytes(b'unplanned other transaction')
                    if location == 'target':
                        with self.assertRaisesRegex(ValueError, 'unplanned SQLite family'): m.relocate(state, apply=True)
                        self.assertFalse((state / m.MARKER).exists())
                    m.save(state / m.MARKER, record)
                    with self.assertRaisesRegex(ValueError, 'unplanned SQLite family'): m.relocate(state, apply=True)
                    self.assertEqual(database.read_bytes(), b'original database')
                    self.assertEqual(sidecar.read_bytes(), b'unplanned other transaction')
                    self.assertEqual(json.loads((state / m.MARKER).read_text())['status'], 'pending')
