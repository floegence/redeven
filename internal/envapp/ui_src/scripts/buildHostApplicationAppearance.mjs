import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { builtInShellThemePresets, BUILT_IN_SHELL_THEME_DEFAULTS } from '@floegence/floe-webapp-core/themes';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, '../../codeapp/appserver/host_application_viewer');
const require = createRequire(import.meta.url);
const source = await build({
  stdin: { contents: `export { enUS } from './src/ui/i18n/locales/en-US'; export { hostApplicationCopyKeys } from './src/ui/services/hostApplicationPresentation'; export { SUPPORTED_LOCALES } from './src/ui/i18n/localeMeta';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { enUS, hostApplicationCopyKeys, SUPPORTED_LOCALES } = await import(`data:text/javascript;base64,${Buffer.from(source.outputFiles[0].text).toString('base64')}`);
const keys = { ...hostApplicationCopyKeys, sessionQuit: 'hostApplications.closeAllWindows', sessionQuitTitle: 'hostApplications.closeAllWindowsTitle', sessionWaitingHint: 'hostApplications.sessionWaitingHint', sessionQuitDescription: 'hostApplications.sessionQuitDescription', sessionPictureHint: 'hostApplications.sessionPictureHint' };
const locales = Object.fromEntries(SUPPORTED_LOCALES.map(locale => {
  const dictionary = locale === 'en-US' ? enUS : JSON.parse(readFileSync(path.join(root, `src/ui/i18n/locales/catalogs/${locale}.json`), 'utf8'));
  return [locale, Object.fromEntries(Object.entries(keys).map(([key, source]) => {
    const value = source.split('.').reduce((value, key) => value?.[key], dictionary);
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing explicit viewer copy: ${locale}:${source}`);
    return [key, value];
  }))];
}));
const style = await build({ entryPoints: [require.resolve('@floegence/floe-webapp-core/standalone.css')], bundle: true, write: false, minify: true });
const catalog = { defaults: BUILT_IN_SHELL_THEME_DEFAULTS, themes: Object.fromEntries(builtInShellThemePresets.map(p => [p.name, p.mode])), locales };
const artifacts = {
  'appearance.generated.css': `/* Generated from published Floe standalone.css; run buildHostApplicationAppearance.mjs. */\n${style.outputFiles[0].text}`,
  'catalog.generated.js': `// Generated from explicit Env App catalogs and published Floe presets.\nconst hostApplicationCatalog = ${JSON.stringify(catalog).replaceAll('<', '\\u003c')};\n`,
};
for (const [file, content] of Object.entries(artifacts)) {
  const target = path.join(output, file);
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== content) throw new Error(`${file} is stale; run node scripts/buildHostApplicationAppearance.mjs`);
  } else writeFileSync(target, content);
}
