#!/usr/bin/env python3
"""Source-only checks for immutable historical Flower upgrade fixtures."""
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / 'internal/ai/testdata/upgrade'
BASELINE = '10ce4c15212c7f4b6d2a449507b9e47d6bc31d1a'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check_fixture(directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    assert re.fullmatch(r'[a-f0-9]{40}', manifest['redeven_commit']), directory
    assert re.fullmatch(r'v7\.\d+\.\d+', manifest['floret_version']), directory
    assert manifest['scenarios'] and len(set(manifest['scenarios'])) == len(manifest['scenarios']), directory
    archive = (directory / 'state.tar.gz').read_bytes()
    assert sha(archive) == manifest['archive_sha256'], f'{directory}: archive changed'
    producer = (directory / 'producer_test.go.txt').read_bytes()
    assert sha(producer) == manifest['producer_sha256'], f'{directory}: writer changed'
    files = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as source:
        for member in source:
            assert member.isfile() and member.size <= 256 * 1024 * 1024, member.name
            assert member.name not in files and not member.name.startswith('/') and '..' not in Path(member.name).parts, member.name
            files[member.name] = sha(source.extractfile(member).read())
    assert files == manifest['files'], f'{directory}: file set changed'
    return manifest


def main():
    manifests = [check_fixture(path) for path in sorted(FIXTURES.iterdir()) if path.is_dir()]
    assert any(item['redeven_commit'] == BASELINE and item['floret_version'] == 'v7.5.0' for item in manifests), 'compatibility baseline is missing'
    compaction = sorted((ROOT / 'internal/ai/testdata').glob('compaction-v*'))
    assert {'compaction-v7.64.0', 'compaction-v7.68.2'} <= {path.name for path in compaction}, 'released compaction writer baseline is missing'
    for directory in compaction:
        manifest = json.loads((directory / 'manifest.json').read_text())
        assert re.fullmatch(r'[a-f0-9]{40}', manifest['writer_commit']), directory
        assert directory.name == 'compaction-' + manifest['writer_version'], directory
        assert {'repeated_automatic_compaction', 'legacy_hash_boundary', 'fork', 'nested_fork'} <= set(manifest['scenarios']), directory
        assert set(manifest['files']) == {'history.sqlite', 'producer_test.go.txt'}, directory
        for name, expected in manifest['files'].items():
            assert sha((directory / name).read_bytes()) == expected, f'{directory}: historical writer bytes changed'
    correction = ROOT / 'internal/ai/testdata/tool-correction-v7.69.1'
    manifest = json.loads((correction / 'manifest.json').read_text())
    assert manifest['writer_version'] == 'v7.69.1', correction
    assert manifest['writer_commit'] == '74f1969bf22608db3241f271268ddd29b9874a2f', correction
    assert {'ordinary_accumulated_correction_exhaustion', 'control_correction_exhaustion', 'confirmed_tool_results', 'fork', 'nested_fork'} <= set(manifest['scenarios']), correction
    assert set(manifest['files']) == {'history.sqlite', 'producer_test.go.txt'}, correction
    for name, expected in manifest['files'].items():
        assert sha((correction / name).read_bytes()) == expected, f'{correction}: historical correction writer changed'
    frozen = ROOT / 'internal/ai/pendinginputlegacy'
    for file in frozen.glob('*.go'):
        if file.name.endswith('_test.go'):
            continue
        source = file.read_text()
        dependencies = re.findall(r'"(github\.com/[^\"]+)"', source)
        assert all(path == 'github.com/floegence/floret/v7/runtime' for path in dependencies), f'{file}: live DTO or private storage dependency'
    migration = (ROOT / 'internal/ai/pending_input_migration.go').read_text()
    for retired_dependency in ('session.Meta', 'decodeStrictJSON', 'normalizeAskFlowerContextActionEnvelope', 'normalizeToolTargetPolicy', 'floretContextProjectionForInput', 'floretTurnInputWithUploadLoader'):
        assert retired_dependency not in migration, f'migration depends on mutable decoder: {retired_dependency}'
    print(f'Flower compatibility source checks passed ({len(manifests)} product, {len(compaction)} compaction and 1 correction writer fixtures).')


if __name__ == '__main__':
    main()
