import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const source = await readFile(new URL('./check_computer_use_webtop.sh', import.meta.url), 'utf8');
const cleanup = source.slice(source.indexOf('cleanup() {'), source.indexOf('\ntrap cleanup EXIT'));

test('Webtop qualification explicitly selects its certificate-backed HTTPS listener', () => {
  assert.match(source, /redeven run[^\n]*--local-ui-protocol https/);
});

for (const scenario of ['auto-remove-pending', 'retained-container', 'daemon-unavailable', 'qualification-failed']) {
  test(`Webtop cleanup: ${scenario}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'webtop-cleanup-test-'));
    try {
      for (const dir of ['bin', 'report', 'state', 'bundle', 'seed', 'workspace']) await mkdir(path.join(root, dir));
      for (const name of ['config.json', 'secrets.json']) await writeFile(path.join(root, 'state', name), '{}');
      await writeFile(path.join(root, 'bin', 'smoke_flower_deepseek.mjs'), '// Secret scanning is covered by the smoke helper tests.\n');
      await writeFile(path.join(root, 'bin', 'computer_webtop_acceptance.mjs'), '// Acceptance is covered by computer_webtop_acceptance.test.mjs.\n');
      await writeFile(path.join(root, 'bin', 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
      await writeFile(path.join(root, 'bin', 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$WORK/docker-calls"
case "$1" in
  stop) exit 0;;
  rm) touch "$WORK/removal-requested"; exit 0;;
  inspect) exit 0;; # Auto-removal has not completed at stop acknowledgement.
  ps)
    [[ "$CASE" != daemon-unavailable ]] || exit 1
    if [[ "$CASE" == auto-remove-pending && ! -f "$WORK/removal-completed" ]]; then touch "$WORK/removal-completed"; printf '%s\\n' "$CID"; exit 0; fi
    if [[ "$CASE" == retained-container || ! -f "$WORK/removal-requested" ]]; then printf '%s\\n' "$CID"; fi;;
  *) exit 2;;
esac
`, { mode: 0o700 });
      const hash = createHash('sha256').update('{}').digest('hex');
      const result = spawnSync('bash', ['-c', `${cleanup}\n(exit "$TEST_STATUS")\ncleanup`], {
        encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CASE: scenario,
          WORK: root, REPORT: `${root}/report`, SOURCE_STATE: `${root}/state`, ROOT_DIR: root,
          SCRIPT_DIR: `${root}/bin`, SCENARIO: 'lifecycle', CID: 'task-owned-exact-id', PORT: '', CONFIG_HASH: hash, SECRETS_HASH: hash,
          TEST_STATUS: scenario === 'qualification-failed' ? '7' : '0' },
      });
      const evidence = JSON.parse(await readFile(`${root}/report/cleanup.json`, 'utf8'));
      const removed = !['retained-container', 'daemon-unavailable'].includes(scenario);
      assert.equal(result.status, removed ? (scenario === 'qualification-failed' ? 7 : 0) : 1, result.stderr);
      assert.equal(evidence.container_removed, removed);
      assert.equal(evidence.temporary_provider_state_removed, removed);
      assert.equal(evidence.source_state_unchanged, true);
      const reads = scenario === 'auto-remove-pending' ? 2 : scenario === 'retained-container' ? 50 : 1;
      assert.equal(await readFile(`${root}/docker-calls`, 'utf8'), 'stop --time 15 task-owned-exact-id\nrm --force task-owned-exact-id\n' + 'ps -aq --no-trunc --filter id=task-owned-exact-id\n'.repeat(reads));
      for (const dir of ['bundle', 'seed', 'workspace']) await assert.rejects(readFile(`${root}/${dir}`), { code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
