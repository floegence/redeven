import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ReadmeValidationError,
  contentSha256,
  validateRepository,
} from './check_readme_localizations.mjs';

const SOURCE_README = `<p align="center">Redeven</p>

# Redeven

<!-- readme-locales:start -->
<p align="center">
  <strong>English</strong> |
  <a href="README.zh-TW.md">繁體中文</a>
</p>
<!-- readme-locales:end -->

<!-- readme-section:about -->
<a id="about"></a>

## About Redeven

Choose Provider and one provider Environment.

[Asset](asset.txt)
`;

const TRANSLATED_README = `<p align="center">Redeven</p>

# Redeven

<!-- readme-locales:start -->
<p align="center">
  <a href="README.md">English</a> |
  <strong>繁體中文</strong>
</p>
<!-- readme-locales:end -->

<!-- readme-section:about -->
<a id="about"></a>

## 關於 Redeven

選擇 Provider 與一個 provider 環境。

[資產](asset.txt)
`;

function writeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'redeven-readme-test-'));
  mkdirSync(join(root, 'assets/readme'), { recursive: true });
  writeFileSync(join(root, 'README.md'), SOURCE_README);
  writeFileSync(join(root, 'README.zh-TW.md'), TRANSLATED_README);
  writeFileSync(join(root, 'AGENTS.md'), '# Rules\n');
  writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), '# Notices\n');
  writeFileSync(join(root, 'asset.txt'), 'asset\n');

  const sourceHash = contentSha256(SOURCE_README);
  const manifest = {
    schema_version: 1,
    source: { locale: 'en-US', file: 'README.md' },
    sections: [{ id: 'about', level: 2 }],
    required_literals: ['Redeven'],
    quality_rules: {
      zh_tw_forbidden_simplified_characters: '这',
      forbidden_generic_english_terms: ['Runtime'],
      fixed_english_term_families: [
        {
          canonical: 'Provider',
          forms: ['Provider', 'Providers', 'provider', 'providers'],
        },
      ],
    },
    shared_visual_exceptions: [],
    tracked_markdown_exceptions: [],
    locales: [
      {
        locale: 'en-US',
        native_name: 'English',
        english_name: 'English',
        file: 'README.md',
      },
      {
        locale: 'zh-TW',
        native_name: '繁體中文',
        english_name: 'Traditional Chinese',
        file: 'README.zh-TW.md',
        review: {
          status: 'pending_subagent_review',
          source_sha256: sourceHash,
          content_sha256: contentSha256(TRANSLATED_README),
          method: null,
          reviewed_by: null,
          reviewed_at: null,
        },
      },
    ],
  };
  writeFileSync(join(root, 'assets/readme/locales.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

function withFixture(run) {
  const root = writeFixture();
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectValidationError(run, messagePart) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof ReadmeValidationError);
    assert.ok(
      error.errors.some((message) => message.includes(messagePart)),
      `expected an error containing ${JSON.stringify(messagePart)}, got ${JSON.stringify(error.errors)}`,
    );
    return true;
  });
}

test('accepts synchronized translations while subagent review is pending', () => {
  withFixture((root) => {
    const result = validateRepository(root);
    assert.deepEqual(result.warnings, [
      'zh-TW (README.zh-TW.md): independent locale-review subagent approval is still pending',
    ]);
  });
});

test('strict mode rejects a pending locale-review subagent approval', () => {
  withFixture((root) => {
    expectValidationError(
      () => validateRepository(root, { requireReviewed: true }),
      'locale-review subagent approval is still pending',
    );
  });
});

test('strict mode accepts an audited locale-review subagent approval', () => {
  withFixture((root) => {
    const manifestPath = join(root, 'assets/readme/locales.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.locales[1].review = {
      ...manifest.locales[1].review,
      status: 'reviewed',
      method: 'subagent',
      reviewed_by: 'subagent:readme_review_test',
      reviewed_at: '2026-07-15',
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = validateRepository(root, { requireReviewed: true });
    assert.deepEqual(result.warnings, []);
  });
});

test('rejects a missing locale file', () => {
  withFixture((root) => {
    unlinkSync(join(root, 'README.zh-TW.md'));
    expectValidationError(() => validateRepository(root), 'root README files are');
  });
});

test('rejects stale translation content hashes', () => {
  withFixture((root) => {
    writeFileSync(join(root, 'README.zh-TW.md'), `${TRANSLATED_README}\n新增內容\n`);
    expectValidationError(() => validateRepository(root), 'content_sha256 is stale');
  });
});

test('rejects a malformed language selector', () => {
  withFixture((root) => {
    const path = join(root, 'README.zh-TW.md');
    const content = readFileSync(path, 'utf8').replace('README.md', 'README.en-US.md');
    writeFileSync(path, content);
    expectValidationError(() => validateRepository(root), 'must link English to README.md');
  });
});

test('rejects broken relative links', () => {
  withFixture((root) => {
    unlinkSync(join(root, 'asset.txt'));
    expectValidationError(() => validateRepository(root), 'local link target does not exist');
  });
});

test('rejects unregistered root README locale files', () => {
  withFixture((root) => {
    writeFileSync(join(root, 'README.ja-JP.md'), '# Redeven\n');
    expectValidationError(() => validateRepository(root), 'root README files are');
  });
});

test('rejects tracked Markdown outside the repository allowlist', () => {
  withFixture((root) => {
    writeFileSync(join(root, 'EXTRA.md'), '# Extra\n');
    execFileSync('git', ['add', 'EXTRA.md'], { cwd: root });
    expectValidationError(() => validateRepository(root), 'tracked Markdown is outside');
  });
});

test('rejects forbidden Simplified Chinese characters in zh-TW', () => {
  withFixture((root) => {
    writeFileSync(join(root, 'README.zh-TW.md'), `${TRANSLATED_README}\n这\n`);
    expectValidationError(() => validateRepository(root), 'forbidden Simplified Chinese characters');
  });
});

test('rejects generic English terminology in a localized README', () => {
  withFixture((root) => {
    writeFileSync(join(root, 'README.zh-TW.md'), `${TRANSLATED_README}\nRuntime\n`);
    expectValidationError(() => validateRepository(root), 'generic English term must be localized');
  });
});

test('rejects translated fixed English domain terms', () => {
  withFixture((root) => {
    const path = join(root, 'README.zh-TW.md');
    const content = readFileSync(path, 'utf8').replace('Provider', '服務供應商');
    writeFileSync(path, content);
    expectValidationError(() => validateRepository(root), 'fixed English term "Provider" count is 0; expected 1');
  });
});
