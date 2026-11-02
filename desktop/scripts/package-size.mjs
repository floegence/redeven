import { createRequire } from 'node:module';
import { lstatSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const appRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = appRequire('@electron/asar');

export function directoryBytes(root) {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  return readdirSync(root).reduce((sum, name) => sum + directoryBytes(path.join(root, name)), 0);
}

export function inspectDesktopArchive(archive) {
  asar.uncache(archive);
  const files = asar.listPackage(archive).flatMap(name => {
    const entry = asar.statFile(archive, name.replace(/^[/]+/, ''));
    return typeof entry.size === 'number' ? [{ path: name.replace(/^[/]+/, ''), bytes: entry.size, unpacked: Boolean(entry.unpacked) }] : [];
  });
  for (const file of files) {
    if (file.path.startsWith('node_modules/@floegence/flowersec-core/dist/interop/') || file.path.endsWith('.map') || /[.](test|spec)[.]/.test(file.path) || new RegExp('(^|/)(testSupport|__tests__|demo|demos)(/|$)').test(file.path)) throw new Error(`Development artifact in Desktop archive: ${file.path}`);
    if (file.path.startsWith('dist/') && !new RegExp('^dist/(main/main[.]js$|preload/(utility|session|web-service-browser|host-application-window)[.]js$|welcome/)').test(file.path)) throw new Error(`Unexpected Desktop entry: ${file.path}`);
  }
  for (const required of ['dist/main/main.js', 'dist/preload/utility.js', 'dist/preload/session.js', 'dist/preload/web-service-browser.js', 'dist/preload/host-application-window.js', 'dist/welcome/index.html']) {
    if (!files.some(file => file.path === required && file.bytes > 0)) throw new Error(`Missing Desktop entry: ${required}`);
  }
  const payloadBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (payloadBytes > 80 * 1024 * 1024) throw new Error(`Desktop application payload exceeds 80 MiB: ${payloadBytes} bytes`);
  const packages = {};
  for (const file of files) {
    const parts = file.path.split('/');
    const group = parts[0] === 'node_modules' ? parts.slice(0, parts[1].startsWith('@') ? 3 : 2).join('/') : 'application';
    packages[group] = (packages[group] ?? 0) + file.bytes;
  }
  return { payload_bytes: payloadBytes, packages, largest_files: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 20) };
}

export function writeDesktopSizeReport(resources, destination, identity, appRoot) {
  const archive = inspectDesktopArchive(path.join(resources, 'app.asar'));
  const components = Object.fromEntries(readdirSync(resources).sort().map(name => [name, directoryBytes(path.join(resources, name))]));
  const bin = path.join(resources, 'bin');
  const runtime = Object.fromEntries(readdirSync(bin).sort().map(name => [name, directoryBytes(path.join(bin, name))]));
  const report = { schema_version: 1, ...identity, app_bytes: directoryBytes(appRoot), components_bytes: components, runtime_bytes: runtime, archive };
  writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(`[desktop-size] application payload ${(archive.payload_bytes / 1048576).toFixed(1)} MiB; report: ${destination}`);
  return report;
}
