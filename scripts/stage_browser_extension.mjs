import { cpSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function stageBrowserExtension(destination) {
  if (!path.isAbsolute(destination)) throw new Error('Extension destination must be absolute.');
  mkdirSync(destination, { recursive: true });
  cpSync(path.join(repo, 'browser-extension'), destination, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    copyFileSync(path.join(repo, 'assets/brand/redeven/png', `app-icon-${size}.png`), path.join(destination, `icon-${size}.png`));
  }
  const requireUI = createRequire(path.join(repo, 'internal/envapp/ui_src/package.json'));
  copyFileSync(requireUI.resolve('@floegence/floe-webapp-core/input-focus.css'), path.join(destination, 'input-focus.css'));
  for (const name of ['computerBrowserPage.mjs', 'computerBrowserController.mjs', 'computerBrowserKeys.mjs']) copyFileSync(path.join(repo, 'internal/envapp/ui_src/scripts', name), path.join(destination, name));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) stageBrowserExtension(process.argv[2]);
