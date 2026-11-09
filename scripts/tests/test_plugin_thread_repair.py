import fcntl
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import repair_prerelease_plugin_threads as repair


class PluginThreadRepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name).resolve()
        (self.state / 'ai').mkdir()
        (self.state / 'apps/plugin-creation').mkdir(parents=True)
        self.source = self.state / 'apps/plugins/platform/author-workspaces/projects/one/source'
        self.source.mkdir(parents=True)
        self.old = self.state / 'author-workspaces/projects/one/source'
        (self.state / repair.MARKER).write_text(json.dumps({'version': 1, 'status': 'complete', 'state': str(self.state), 'operations': [{'source': 'author-workspaces', 'target': 'apps/plugins/platform/author-workspaces'}]}))
        self.settings = self.state / 'ai/threads.sqlite'
        with sqlite3.connect(self.settings) as db:
            db.execute('CREATE TABLE ai_thread_settings(thread_id TEXT PRIMARY KEY, endpoint_id TEXT, working_dir TEXT, settings_updated_at_unix_ms INTEGER, model_id TEXT)')
            db.execute('INSERT INTO ai_thread_settings VALUES(?,?,?,?,?)', ('one', 'local', str(self.old), 1, 'chosen/model'))
            db.execute('INSERT INTO ai_thread_settings VALUES(?,?,?,?,?)', ('ordinary', 'local', '/ordinary', 1, 'other/model'))
        self.drafts = self.state / 'apps/plugin-creation/drafts.sqlite'
        with sqlite3.connect(self.drafts) as db:
            db.execute('CREATE TABLE drafts(id TEXT,owner_env TEXT,thread_id TEXT,workspace_id TEXT,lifecycle TEXT,launch_snapshot TEXT)')
            db.execute('INSERT INTO drafts VALUES(?,?,?,?,?,?)', ('draft', 'local', 'one', 'workspace', 'active', 'immutable-create-evidence'))
        for path, kind, version in ((self.settings, 'ai_threadstore_product_v1', 13), (self.drafts, 'redeven_plugin_drafts', 1)):
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE __redeven_db_meta(singleton INTEGER PRIMARY KEY,db_kind TEXT)')
                db.execute('INSERT INTO __redeven_db_meta VALUES(1,?)', (kind,))
                db.execute(f'PRAGMA user_version={version}')
        self.bindings = [{'workspace_id': 'workspace', 'source_directory': str(self.source)}]

    def test_preview_atomic_apply_and_idempotent_restart_preserve_other_data(self):
        before = self.settings.read_bytes()
        frozen = self.drafts.read_bytes()
        self.assertEqual(len(repair.repair(self.state, self.bindings)['operations']), 1)
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertEqual(len(repair.repair(self.state, self.bindings, True)['operations']), 1)
        with sqlite3.connect(self.settings) as db:
            self.assertEqual(db.execute('SELECT working_dir,model_id FROM ai_thread_settings WHERE thread_id=\'one\'').fetchone(), (str(self.source), 'chosen/model'))
            self.assertEqual(db.execute('SELECT working_dir FROM ai_thread_settings WHERE thread_id=\'ordinary\'').fetchone(), ('/ordinary',))
        repaired = self.settings.read_bytes()
        self.assertEqual(repair.repair(self.state, self.bindings, True)['operations'], [])
        self.assertEqual(self.settings.read_bytes(), repaired)
        self.assertEqual(self.drafts.read_bytes(), frozen)

    def test_invalid_binding_and_missing_binding_leave_state_unchanged(self):
        before = self.settings.read_bytes()
        for bindings in ([], self.bindings * 2, [{'workspace_id': 'foreign', 'source_directory': str(self.source)}]):
            with self.subTest(bindings=bindings), self.assertRaises(ValueError):
                repair.repair(self.state, bindings, True)
            self.assertEqual(self.settings.read_bytes(), before)

    def test_live_runtime_lease_blocks_apply(self):
        with (self.state / 'agent.lock').open('w') as lease:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                repair.repair(self.state, self.bindings, True)

    def test_unrelated_directory_never_reassigned(self):
        with sqlite3.connect(self.settings) as db:
            db.execute('UPDATE ai_thread_settings SET working_dir=? WHERE thread_id=?', ('/unrelated', 'one'))
        before = self.settings.read_bytes()
        with self.assertRaises(ValueError):
            repair.repair(self.state, self.bindings, True)
        self.assertEqual(self.settings.read_bytes(), before)

    def test_future_or_foreign_database_is_rejected_unchanged(self):
        for path in (self.drafts, self.settings):
            for statement in ("PRAGMA user_version=999", "UPDATE __redeven_db_meta SET db_kind='foreign'"):
                with self.subTest(path=path, statement=statement):
                    original = path.read_bytes()
                    with sqlite3.connect(path) as db:
                        db.execute(statement)
                    before = path.read_bytes()
                    with self.assertRaises(ValueError):
                        repair.repair(self.state, self.bindings, True)
                    self.assertEqual(path.read_bytes(), before)
                    path.write_bytes(original)

    def test_interrupted_write_rolls_back_all_settings(self):
        second = self.source.parent.parent / 'two/source'
        second.mkdir(parents=True)
        with sqlite3.connect(self.settings) as db:
            db.execute('INSERT INTO ai_thread_settings VALUES(?,?,?,?,?)', ('two', 'local', str(self.old.parent.parent / 'two/source'), 1, 'model'))
            db.execute("CREATE TRIGGER interrupt_repair BEFORE UPDATE ON ai_thread_settings WHEN old.thread_id='two' BEGIN SELECT RAISE(ABORT,'simulated interruption'); END")
        with sqlite3.connect(self.drafts) as db:
            db.execute('INSERT INTO drafts VALUES(?,?,?,?,?,?)', ('draft-two', 'local', 'two', 'workspace-two', 'active', 'frozen'))
        bindings = self.bindings + [{'workspace_id':'workspace-two','source_directory':str(second)}]
        before = self.settings.read_bytes()
        with self.assertRaises(sqlite3.IntegrityError):
            repair.repair(self.state, bindings, True)
        self.assertEqual(self.settings.read_bytes(), before)
        with sqlite3.connect(self.settings) as db:
            db.execute('DROP TRIGGER interrupt_repair')
        self.assertEqual(len(repair.repair(self.state, bindings, True)['operations']), 2)
