import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  sha256,
  verifyBundledIconIntegrity,
} from '../../../../scripts/terminal_agent_icon_integrity.mjs';

function withTempIcon(content, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-agent-icon-'));
  const filePath = path.join(directory, 'icon.svg');
  fs.writeFileSync(filePath, content);
  try {
    run(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('accepts an exact pinned upstream icon', () => {
  const bytes = Buffer.from('<svg/>', 'utf8');
  withTempIcon(bytes, (filePath) => {
    verifyBundledIconIntegrity({
      filePath,
      bundledSha256: sha256(bytes),
      upstreamSha256: sha256(bytes),
      modified: false,
    });
  });
});

test('accepts exactly one added trailing newline', () => {
  const upstream = Buffer.from('<svg/>', 'utf8');
  const bundled = Buffer.from('<svg/>\n', 'utf8');
  withTempIcon(bundled, (filePath) => {
    verifyBundledIconIntegrity({
      filePath,
      bundledSha256: sha256(bundled),
      upstreamSha256: sha256(upstream),
      modified: 'trailing_newline_only',
    });
  });
});

test('rejects redrawn bytes even when the bundled hash is updated', () => {
  const upstream = Buffer.from('<svg/>', 'utf8');
  const redrawn = Buffer.from('<svg><path/></svg>\n', 'utf8');
  withTempIcon(redrawn, (filePath) => {
    assert.throws(() => verifyBundledIconIntegrity({
      filePath,
      bundledSha256: sha256(redrawn),
      upstreamSha256: sha256(upstream),
      modified: 'trailing_newline_only',
    }), /differs from pinned upstream/u);
  });
});
