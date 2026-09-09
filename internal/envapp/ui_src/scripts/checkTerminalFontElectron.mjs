#!/usr/bin/env node
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chooseFont, settings, verifyFontInteraction } from './checkTerminalFontCarrier.mjs';
import { selectSurface, activateSession, runtimeTrace, waitForTrace } from './checkSemanticTerminalCarrier.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const config = JSON.parse(await readFile(option('--config'), 'utf8'));
const output = path.resolve(option('--output'));
await mkdir(output, { recursive: true });
const entry = path.join(output, 'font-electron.cjs');
await writeFile(entry, `const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.env.REDEVEN_FONT_TEST_CONFIG, 'utf8'));
app.commandLine.appendSwitch('lang', 'en-US');
app.commandLine.appendSwitch('ignore-certificate-errors-spki-list', config.spki);
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1280, height: 850, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.loadURL(config.url);
});
app.on('window-all-closed', () => app.quit());
`);
const profile = await mkdtemp(path.join(os.tmpdir(), 'redeven-font-electron-'));
const app = await electron.launch({ executablePath: option('--executable'), args: [entry, `--user-data-dir=${profile}`], env: { ...process.env, REDEVEN_FONT_TEST_CONFIG: path.resolve(option('--config')) } });
const report = { platform: process.platform, versions: await app.evaluate(() => process.versions), fonts: [] };
try {
  const page = await app.firstWindow();
  const password = page.locator('input[type="password"]');
  await password.waitFor();
  await password.fill(config.password);
  await password.press('Enter');
  const panel = await selectSurface(page, 'panel');
  const terminal = await activateSession(panel, config.sessionID);
  const dialog = await settings(page, panel);
  const labels = ['JetBrains Mono', 'Iosevka', 'Cascadia Mono', 'Consolas'];
  const available = [];
  for (const label of labels) {
    const button = dialog.getByRole('button', { name: new RegExp(`^${label}`) });
    if (await button.count() && await button.isEnabled()) available.push(label);
  }
  await page.keyboard.press('Escape');
  for (const label of available) {
    await chooseFont(page, panel, label);
    const trace = await waitForTrace(terminal, (value) => value.is_controller && value.geometry_cols === value.measured_cols && value.geometry_rows === value.measured_rows);
    report.fonts.push({ label, trace });
    await page.screenshot({ path: path.join(output, `electron-${label.replaceAll(' ', '-')}.png`) });
  }
  if (!available.includes('JetBrains Mono') || !available.includes('Iosevka')) throw new Error('Bundled Electron font is unavailable');
  const trace = await runtimeTrace(terminal);
  const restore = await fetch(`${config.coordinator}/activate?epoch=${trace.controller_epoch}`, { headers: { Authorization: `Bearer ${config.password}` } });
  if (!restore.ok) throw new Error('Could not return control to the test coordinator');
  report.interaction = await verifyFontInteraction(page, panel, config);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(path.join(output, 'font-electron-report.json'), JSON.stringify(report, null, 2));
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
