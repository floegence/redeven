#!/usr/bin/env python3
"""Explicit offline pre-release relocation. Never invoked by Runtime startup.

IMPORTANT: Rename opaque upstream files with their SQLite sidecars; never open,
convert, repair or reset them. The journal fences startup until all exact moves
verify. Conflicting targets and symlinks fail closed. Shared user skills are
copied only with an explicit source; their originals remain untouched.
"""
import argparse
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile

PLUGIN_NAMES = ('control.sqlite', 'secrets.sqlite', 'observability.sqlite',
                'plugin-data', 'external-inspections', 'assets', 'runtime-exec',
                'author-workspaces', 'release-artifacts', 'trust')
MARKER = 'storage-relocation.json'


def fingerprint(path):
    """Hash regular bytes and relative names; reject links/special files."""
    result = hashlib.sha256()
    def visit(item, relative):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError(f'unsupported filesystem entry: {item}')
        result.update(relative.encode() + b'\0' + str(stat.S_IMODE(info.st_mode)).encode() + b'\0')
        if stat.S_ISDIR(info.st_mode):
            result.update(b'directory\0')
            for child in sorted(item.iterdir()):
                visit(child, relative + '/' + child.name)
        else:
            result.update(b'file\0' + str(info.st_size).encode() + b'\0')
            with item.open('rb') as stream:
                while chunk := stream.read(1024 * 1024): result.update(chunk)
    visit(path, '.')
    return result.hexdigest()


def secure_path(root, relative):
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(p in ('.', '..') for p in parts):
        raise ValueError('invalid relative relocation path')
    cursor = root
    for part in parts:
        cursor /= part
        if cursor.is_symlink(): raise ValueError(f'symlink rejected: {cursor}')
    return cursor


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def mkdir_durable(path):
    if path.exists(): return
    mkdir_durable(path.parent)
    path.mkdir(mode=0o700)
    sync_dir(path.parent)


def save(path, data):
    fd, temporary = tempfile.mkstemp(prefix='.storage-relocation-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(data, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path); sync_dir(path.parent)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


@contextlib.contextmanager
def offline_lock(state):
    descriptors = []
    try:
        # Keep Runtime, old/new upstream Host and author leases for the entire
        # rename transaction. Lock files are never moved or removed.
        names = ['agent.lock', '.redevplugin-environment.lock',
                 'apps/plugins/platform/.redevplugin-environment.lock',
                 'author-workspaces', 'apps/plugins/platform/author-workspaces']
        for name in names:
            path = secure_path(state, name)
            if name != 'agent.lock' and not path.exists(): continue
            flags = os.O_RDONLY if path.is_dir() else os.O_RDWR
            if name == 'agent.lock': flags |= os.O_CREAT
            fd = os.open(path, flags | os.O_NOFOLLOW, 0o600)
            descriptors.append(fd)
            if not stat.S_ISDIR(os.fstat(fd).st_mode) and os.fstat(fd).st_nlink != 1:
                raise ValueError('lock must be a unique regular file')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        for fd in reversed(descriptors): os.close(fd)


def allowed_moves():
    pairs = {}
    for name in PLUGIN_NAMES:
        for suffix in (('', '-wal', '-shm', '-journal') if name.endswith('.sqlite') else ('',)):
            pairs[name + suffix] = 'apps/plugins/platform/' + name + suffix
    pairs.update({'skills_state.json':'apps/skills/state.json', 'skills_sources.json':'apps/skills/sources.json'})
    return pairs


def skill_source_identity(source, state):
    # Preserve lexical paths (including /var aliases) while binding filesystem
    # identity. A missing source must never turn an explicit copy into a no-op.
    if not source.is_absolute() or source.is_symlink() or not source.is_dir():
        raise ValueError('existing absolute real skills source directory required')
    canonical = source.resolve(strict=True)
    if state == canonical or state in canonical.parents or canonical in state.parents:
        raise ValueError('skills source overlaps environment')
    return canonical


def metadata_final(record, state):
    originals = record.get('metadata_sources', {})
    operations = {op['target']: op for op in record['operations']}
    expected = {Path(target).name for target in operations if target.startswith('apps/skills/')}
    if set(originals) != expected or (expected and not record.get('skills')):
        raise ValueError('metadata is not bound to planned source operations')
    result = {}
    for filename, original in originals.items():
        if filename not in ('state.json', 'sources.json'):
            raise ValueError('unowned metadata target')
        raw = base64.b64decode(original['bytes'], validate=True)
        mode = original['mode']
        if not isinstance(mode, int) or not 0 <= mode <= 0o7777:
            raise ValueError('invalid source metadata mode')
        digest = hashlib.sha256(b'.\0' + str(mode).encode() + b'\0file\0' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        if digest != operations['apps/skills/' + filename]['sha256']:
            raise ValueError('metadata bytes do not match planned source fingerprint')
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('schema_version') != 1:
            raise ValueError('unsupported skill metadata')
        prefixes = sorted({record['skills']['source'], record['skills']['canonical']}, key=len, reverse=True)
        destination = str(state / 'apps/skills/packages')
        def rewrite(value):
            if not isinstance(value, str) or not Path(value).is_absolute():
                raise ValueError('invalid skill path')
            # Scope is lexical: an external user_agents alias of the same tree
            # must keep its own enablement. Only the explicitly selected prefix
            # and its canonical spelling describe the managed source scope.
            for prefix in prefixes:
                if value == prefix or value.startswith(prefix + '/'):
                    return destination + value[len(prefix):]
            return value
        if filename == 'state.json':
            data['disabled_paths'] = [rewrite(p) for p in data.get('disabled_paths', [])]
        else:
            for item in data.get('items', []): item['skill_path'] = rewrite(item['skill_path'])
        result[filename] = data
    return result


def validate_record(record, state, requested_source=None):
    if set(record) != {'version', 'state', 'status', 'operations', 'skills', 'metadata_sources'}:
        raise ValueError('unrecognized relocation journal fields')
    if record.get('version') != 1 or record.get('state') != str(state) or record.get('status') not in ('pending', 'complete'):
        raise ValueError('unrecognized relocation journal')
    allowed, seen = allowed_moves(), set()
    for operation in record['operations']:
        source, target = operation['source'], operation['target']
        digest = operation['sha256']
        if source in seen or allowed.get(source) != target or not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('journal contains an unowned relocation')
        seen.add(source)
    # IMPORTANT: SQLite sidecars are inseparable from the planned main file.
    # An orphan WAL must not be handed to an owner that could create an empty
    # database and discard the retained transaction bytes.
    for source in seen:
        for suffix in ('-wal', '-shm', '-journal'):
            if source.endswith('.sqlite' + suffix) and source[:-len(suffix)] not in seen:
                raise ValueError(f'orphan SQLite sidecar requires inspection: {source}')
    if record['status'] == 'pending':
        for database in (name for name in seen if name.endswith('.sqlite')):
            for suffix in ('', '-wal', '-shm', '-journal'):
                name = database + suffix
                source = secure_path(state, name)
                target = secure_path(state, allowed[name])
                if name not in seen and (source.exists() or target.exists()):
                    raise ValueError(f'unplanned SQLite family entry requires inspection: {name}')
                if source.exists() and target.exists():
                    raise ValueError(f'conflicting SQLite family entry: {name}')
    skills = record.get('skills')
    if skills:
        canonical = skill_source_identity(Path(skills['source']), state)
        if str(canonical) != skills['canonical']:
            raise ValueError('recorded skill source identity changed')
    if requested_source is not None and (not skills or str(skill_source_identity(requested_source, state)) != skills['canonical']):
        raise ValueError('requested skills source differs from journal; a separate migration is required')
    # IMPORTANT: Never trust cached final JSON from a recovery journal. Only the
    # exact original bytes bound to the move fingerprint may produce metadata.
    return metadata_final(record, state)


def plan(state, skills_source=None):
    operations = []
    originals = {}
    if skills_source is not None: skill_source_identity(skills_source, state)
    for name in PLUGIN_NAMES:
        for suffix in (('', '-wal', '-shm', '-journal') if name.endswith('.sqlite') else ('',)):
            source = name + suffix
            target = 'apps/plugins/platform/' + source
            if secure_path(state, source).exists():
                if secure_path(state, target).exists(): raise ValueError(f'conflicting destination: {target}')
                operations.append({'source': source, 'target': target, 'sha256': fingerprint(state / source)})
    for old, new in [('skills_state.json', 'state.json'), ('skills_sources.json', 'sources.json')]:
        if secure_path(state, old).exists():
            target = 'apps/skills/' + new
            if secure_path(state, target).exists(): raise ValueError(f'conflicting destination: {target}')
            raw = (state / old).read_bytes()
            data = json.loads(raw)
            if data.get('schema_version') != 1: raise ValueError('unsupported skill metadata')
            if skills_source is None: raise ValueError('skill metadata requires explicit --skills-source')
            operations.append({'source': old, 'target': target, 'sha256': fingerprint(state / old)})
            originals[new] = {'bytes': base64.b64encode(raw).decode('ascii'), 'mode': stat.S_IMODE((state / old).stat().st_mode)}
    if skills_source is not None:
        if secure_path(state, 'apps/skills/packages').exists(): raise ValueError('managed skill destination already exists')
        skills = {'source': str(skills_source), 'canonical': str(skills_source.resolve(strict=True)), 'sha256': fingerprint(skills_source)}
    else: skills = None
    record = {'version': 1, 'state': str(state), 'status': 'pending', 'operations': operations, 'skills': skills, 'metadata_sources': originals}
    validate_record(record, state, skills_source)
    return record


def relocate(state, skills_source=None, apply=False):
    if not state.is_absolute() or state.is_symlink() or not state.is_dir(): raise ValueError('existing absolute real state directory required')
    state = state.resolve()
    if skills_source is not None:
        skill_source_identity(skills_source, state)
    marker = secure_path(state, MARKER)
    if marker.exists():
        record = json.loads(marker.read_text())
        validate_record(record, state, skills_source)
        if record['status'] == 'complete': return record
        if not apply: return record
    else: record = plan(state, skills_source)
    if not apply: return record
    with offline_lock(state):
        # Revalidate the entire plan under the live Runtime lease before writing.
        if marker.exists():
            record = json.loads(marker.read_text()); validate_record(record, state, skills_source)
            if record['status'] == 'complete': return record
        else:
            record = plan(state, skills_source)
            save(marker, record)
        finals = validate_record(record, state, skills_source)
        for operation in record['operations']:
            source, target = (secure_path(state, operation[k]) for k in ('source', 'target'))
            if source.exists() and target.exists(): raise ValueError(f'ambiguous relocation: {source}')
            current = source if source.exists() else target
            expected = operation['sha256']
            final = finals.get(target.name) if operation['target'].startswith('apps/skills/') else None
            matches_final = current == target and final is not None and json.loads(target.read_text()) == final
            if not current.exists() or (fingerprint(current) != expected and not matches_final): raise ValueError(f'changed relocation input: {current}')
        skills = record['skills']
        if skills:
            source = Path(skills['source']); destination = secure_path(state, 'apps/skills/packages')
            if not destination.exists():
                if fingerprint(source) != skills['sha256']: raise ValueError('shared skills changed after review')
                mkdir_durable(destination.parent)
                stage = secure_path(state, 'apps/skills/.packages-relocation')
                if stage.exists(): raise ValueError(f'incomplete skill copy retained at {stage}; inspect it, move it outside this Environment without deleting it, then rerun the same command')
                shutil.copytree(source, stage, symlinks=True)
                if fingerprint(stage) != skills['sha256']: raise ValueError('skill copy verification failed')
                for item in stage.rglob('*'):
                    if item.is_file():
                        with item.open('rb') as stream: os.fsync(stream.fileno())
                for directory, _, _ in os.walk(stage, topdown=False): sync_dir(directory)
                os.rename(stage, destination); sync_dir(destination.parent)
            elif fingerprint(destination) != skills['sha256']: raise ValueError('managed skills changed during relocation')
        for operation in record['operations']:
            source, target = (secure_path(state, operation[k]) for k in ('source', 'target'))
            if source.exists():
                mkdir_durable(target.parent)
                os.rename(source, target); sync_dir(source.parent); sync_dir(target.parent)
            final = finals.get(target.name) if operation['target'].startswith('apps/skills/') else None
            if fingerprint(target) != operation['sha256'] and not (final is not None and json.loads(target.read_text()) == final): raise ValueError('post-move verification failed')
        # Originals were durably bound to their fingerprints before any move.
        # Recompute the only allowed transform on every resume, including after
        # a crash between publishing the two product-owned metadata files.
        for filename, data in finals.items(): save(state / 'apps/skills' / filename, data)
        record['status'] = 'complete'; save(marker, record)
    return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', required=True, type=Path)
    parser.add_argument('--skills-source', type=Path)
    parser.add_argument('--apply', action='store_true', help='commit after acquiring the stopped Runtime lease')
    args = parser.parse_args()
    try:
        result = relocate(args.state_dir, args.skills_source, args.apply)
        print(json.dumps({k: v for k, v in result.items() if k != 'metadata_sources'}, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'Relocation stopped without discarding data: {error}\n')
