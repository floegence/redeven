import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { Snapshot } from '@floegence/redeven-service-templates';
import { DesktopTemplateSources } from './templateSources';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('acquires the shared historical Runtime fixture with the published SDK and without git', async () => {
  const fixture: Snapshot = JSON.parse(
    readFileSync('../internal/managedwebservice/testdata/github-source-transfer.json', 'utf8'),
  );
  const blobs = new Map<string, Buffer>();
  const tree = fixture.files.map((file) => {
    const bytes = Buffer.from(file.content, 'base64');
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    blobs.set(sha, bytes);
    return { path: file.path, mode: file.mode, type: 'blob', sha, size: bytes.length };
  });
  vi.stubEnv('PATH', '');
  vi.stubGlobal('fetch', async (input: string, options: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe('https://api.github.com');
    expect(options.redirect).toBe('error');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer temporary-source-token');
    let body: unknown;
    switch (url.pathname) {
      case '/repos/example/templates':
        body = { id: 123, full_name: 'example/templates', default_branch: 'develop' };
        break;
      case '/repos/example/templates/commits/develop':
        body = { sha: fixture.source.commit_sha, commit: { tree: { sha: fixture.source.tree_sha } } };
        break;
      case `/repos/example/templates/git/trees/${fixture.source.tree_sha}`:
        body = { sha: fixture.source.tree_sha, tree, truncated: false };
        break;
      default: {
        expect(url.pathname).toMatch(/^\/repos\/example\/templates\/git\/blobs\/[a-f0-9]{40}$/);
        const sha = url.pathname.split('/').at(-1)!;
        const bytes = blobs.get(sha)!;
        body = { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') };
      }
    }
    return new Response(JSON.stringify(body));
  });
  const result = await new DesktopTemplateSources().acquire(1, {
    operation_id: 'source-transfer',
    action: 'capture',
    source: { repository: 'example/templates' },
    token: 'temporary-source-token',
  });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  expect(result.snapshot?.sha256).toBe(fixture.sha256);
  expect(result.snapshot?.files).toEqual([...fixture.files].sort((a, b) => (a.path < b.path ? -1 : 1)));
  expect(JSON.stringify(result)).not.toContain('temporary-source-token');
});
