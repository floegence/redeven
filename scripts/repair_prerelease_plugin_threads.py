#!/usr/bin/env python3
"""One-time offline repair of host-owned plugin conversation directories.

Bindings must be exported through the released author workspace API for the
exact owner. This utility never interprets upstream storage schemas.
Upstream databases and frozen creation requests are never modified.
"""
import argparse
import json
import sqlite3
import time
from pathlib import Path

from relocate_prerelease_storage import MARKER, offline_lock, secure_path


def connect(path, mode='ro'):
    if not path.is_file() or path.is_symlink():
        raise ValueError(f'host database must be an existing regular file: {path}')
    db = sqlite3.connect(path.as_uri() + '?mode=' + mode, uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    return db


def verify_database(db, kind, version):
    actual = db.execute('PRAGMA user_version').fetchone()[0]
    metadata = db.execute('SELECT singleton,db_kind FROM __redeven_db_meta').fetchall()
    if actual != version or [tuple(row) for row in metadata] != [(1, kind)]:
        raise ValueError('unsupported host database identity or schema version')


def plan(state, bindings):
    record = json.loads(secure_path(state, MARKER).read_text())
    if record.get('version') != 1 or record.get('status') != 'complete' or record.get('state') != str(state):
        raise ValueError('completed relocation for this exact environment is required')
    moves = [op for op in record.get('operations', []) if op.get('source') == 'author-workspaces']
    if len(moves) != 1 or moves[0].get('target') != 'apps/plugins/platform/author-workspaces':
        raise ValueError('author workspace relocation evidence is missing')
    old_root = secure_path(state, moves[0]['source'])
    new_root = secure_path(state, moves[0]['target'])
    if old_root.exists() or not new_root.is_dir():
        raise ValueError('author workspace relocation is not settled')
    if not isinstance(bindings, list):
        raise ValueError('workspace bindings must be a list')
    sources = {}
    for item in bindings:
        if not isinstance(item, dict) or set(item) != {'workspace_id', 'source_directory'}:
            raise ValueError('invalid workspace source binding')
        key, directory = item['workspace_id'], item['source_directory']
        if not isinstance(key, str) or not key or key in sources or not isinstance(directory, str):
            raise ValueError('invalid or duplicate workspace binding')
        source = Path(directory)
        if not source.is_absolute() or source.resolve(strict=True) != source or not source.is_dir() or not source.is_relative_to(new_root):
            raise ValueError('source binding is not an exact relocated directory')
        sources[key] = source
    drafts = connect(secure_path(state, 'apps/plugin-creation/drafts.sqlite'))
    settings = connect(secure_path(state, 'ai/threads.sqlite'))
    operations = []
    try:
        verify_database(drafts, 'redeven_plugin_drafts', 1)
        verify_database(settings, 'ai_threadstore_product_v1', 13)
        owned = drafts.execute("SELECT id,owner_env,thread_id,workspace_id FROM drafts WHERE lifecycle='active' AND thread_id<>''").fetchall()
        seen = set()
        for draft in owned:
            row = settings.execute('SELECT working_dir FROM ai_thread_settings WHERE thread_id=? AND endpoint_id=?', (draft['thread_id'], draft['owner_env'])).fetchone()
            if row is None:
                raise ValueError('bound plugin conversation settings are missing')
            previous = Path(row['working_dir'])
            current = sources.get(draft['workspace_id'])
            if current is None:
                if previous.is_relative_to(old_root):
                    raise ValueError('missing authenticated binding for retained conversation')
                continue
            seen.add(draft['workspace_id'])
            if previous == current:
                continue
            if not previous.is_relative_to(old_root) or new_root / previous.relative_to(old_root) != current:
                raise ValueError('retained directory does not match the exact relocation')
            operations.append({'thread_id': draft['thread_id'], 'endpoint_id': draft['owner_env'], 'workspace_id': draft['workspace_id'], 'previous': str(previous), 'current': str(current)})
        if set(sources) != seen:
            raise ValueError('source binding has no active owned conversation')
        return operations
    finally:
        drafts.close()
        settings.close()


def repair(state, bindings, apply=False):
    if not state.is_absolute() or state.is_symlink() or not state.is_dir():
        raise ValueError('existing absolute environment directory required')
    state = state.resolve(strict=True)
    if not apply:
        return {'status': 'planned', 'operations': plan(state, bindings)}
    with offline_lock(state):
        operations = plan(state, bindings)
        db = connect(secure_path(state, 'ai/threads.sqlite'), 'rw')
        try:
            with db:
                db.execute('BEGIN IMMEDIATE')
                verify_database(db, 'ai_threadstore_product_v1', 13)
                for item in operations:
                    result = db.execute('UPDATE ai_thread_settings SET working_dir=?,settings_updated_at_unix_ms=? WHERE thread_id=? AND endpoint_id=? AND working_dir=?',
                        (item['current'], int(time.time() * 1000), item['thread_id'], item['endpoint_id'], item['previous']))
                    if result.rowcount != 1:
                        raise ValueError('conversation changed after repair planning')
            return {'status': 'complete', 'operations': operations}
        finally:
            db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--bindings', type=Path, required=True, help='owner-verified workspace_id/source_directory bindings from the released API')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(repair(args.state_dir, json.loads(args.bindings.read_text()), args.apply), indent=2))
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Plugin conversation repair stopped: {error}\n')
