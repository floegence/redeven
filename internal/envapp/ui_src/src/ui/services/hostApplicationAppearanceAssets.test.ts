import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('embeds current public theme assets and complete explicit locale catalogs', () => {
  expect(() => execFileSync(process.execPath, ['scripts/buildHostApplicationAppearance.mjs', '--check'], {stdio:'pipe'})).not.toThrow();
  const css = readFileSync(resolve('../../codeapp/appserver/host_application_viewer/appearance.generated.css'), 'utf8');
  // Keep the standalone document independent of full component/utility CSS and
  // network font loading. Formal builds use released packages, never siblings.
  // Budget the published CSS payload; the generator's provenance line is metadata.
  const provenance = '/* Generated from published Floe standalone.css; run buildHostApplicationAppearance.mjs. */\n';
  expect(css.startsWith(provenance)).toBe(true);
  expect(Buffer.byteLength(css.slice(provenance.length))).toBeLessThan(100_000);
  expect(css).not.toContain('@import');
  expect(css).not.toContain('url(');
});
