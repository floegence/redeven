import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const stylesheet = readFileSync(new URL('../internal/flower_ui/src/styles/flower.css', import.meta.url), 'utf8');
const rules = [...stylesheet.matchAll(/\.flower-chat-md-content::highlight\(flower-stream-(\d+)\)\s*\{([^}]+)\}/gu)];
const input = rules.map(([rule]) => rule).join('\n');

for (const [host, manifest] of [
  ['Desktop', '../desktop/package.json'],
  ['EnvApp', '../internal/envapp/ui_src/package.json'],
]) {
  for (const minify of [false, true]) {
    test(`${host} preserves streaming highlight phases without CSS optimizer warnings (minify=${minify})`, (t) => {
      // Resolve the optimizer through the installed Vite plugin: Vite can use a
      // newer Lightning CSS while Tailwind still resolves an incompatible copy.
      const require = createRequire(new URL(manifest, import.meta.url));
      const tailwindRequire = createRequire(require.resolve('@tailwindcss/vite'));
      const { optimize } = tailwindRequire('@tailwindcss/node');
      const warn = t.mock.method(console, 'warn', () => {});
      const result = optimize(input, { minify });
      assert.equal(rules.length, 20, 'the reveal controller requires twenty fixed paint phases');
      assert.equal(warn.mock.callCount(), 0, 'valid highlight selectors must not require parser recovery');
      const output = result.code.toString();
      assert.equal([...output.matchAll(/::highlight\(/gu)].length, rules.length);
      for (const [, phase, declarations] of rules) {
        const expectedPercentage = Number(declarations.match(/currentColor\s+([\d.]+)%/u)[1]);
        const declaration = output.match(new RegExp(`::highlight\\(flower-stream-${phase}\\)\\s*\\{([^}]+)\\}`, 'u'))?.[1];
        assert.ok(declaration, `missing highlight phase ${phase}`);
        const color = declaration.match(/color:\s*color-mix\(in srgb,\s*currentColor\s+([\d.]+)%,\s*transparent\)/u);
        assert.ok(color, `phase ${phase} must retain inherited text color and transparency`);
        assert.equal(Number(color[1]), expectedPercentage, `phase ${phase} must retain its fade percentage`);
      }
    });
  }
}
