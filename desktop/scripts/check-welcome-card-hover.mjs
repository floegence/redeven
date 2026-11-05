import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { chromium } from '../../internal/envapp/ui_src/node_modules/playwright/index.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = resolve(process.env.REDEVEN_WELCOME_HOVER_OUTPUT || fileURLToPath(new URL('../dist/welcome-card-hover/', import.meta.url)));
await mkdir(output, { recursive: true });
const server = await createSSHSettingsPreviewServer(0, ['welcome-cards.html', 'environment-settings.html']);
await server.watcher.close();
const browser = await chromium.launch({ headless: true });
const report = { cases: [], systemCases: [], welcomeCases: [], errors: [], failures: [],
  cssHash: createHash('sha256').update(await readFile(new URL('../src/welcome/index.css', import.meta.url))).digest('hex'),
  publishedCore: JSON.parse(await readFile(new URL('../node_modules/@floegence/floe-webapp-core/package.json', import.meta.url))).version };
const check = (condition, message) => { if (!condition) report.failures.push(message); };
const distance = (a, b) => Math.max(...a.slice(0, 3).map((value, index) => Math.abs(value - b[index])));
const read = element => {
  const style = getComputedStyle(element), canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
  return { color: [...context.getImageData(0, 0, 1, 1).data], image: style.backgroundImage, shadow: style.boxShadow,
    border: style.borderTopColor, transform: style.transform, rect: element.getBoundingClientRect().toJSON() };
};
const settle = page => page.evaluate(() => document.getAnimations().forEach(animation => { if (animation.effect?.getTiming().iterations !== Infinity) animation.finish(); }));
async function paintTransition(card) {
  return card.evaluate(async element => {
    // Force a style flush after the trusted pointer event, then sample the actual
    // browser transition at reproducible phases rather than timer-dependent frames.
    getComputedStyle(element).backgroundColor;
    const animations = element.getAnimations();
    const timing = animations.map(animation => ({ property: animation.transitionProperty, duration: animation.effect.getTiming().duration }));
    animations.forEach(animation => animation.pause());
    const colors = [];
    for (const progress of [0, .25, .5, .75, 1]) {
      animations.forEach(animation => { animation.currentTime = Number(animation.effect.getTiming().duration) * progress; });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.fillStyle = getComputedStyle(element).backgroundColor; context.fillRect(0, 0, 1, 1);
      colors.push([...context.getImageData(0, 0, 1, 1).data]);
    }
    animations.forEach(animation => animation.finish());
    return { timing, colors };
  });
}
function checkTransition(result, label, reduced = false) {
  if (reduced) {
    check(result.timing.every(item => item.duration <= 1), `${label}: reduced motion is immediate`);
    return;
  }
  check(result.timing.some(item => item.property === 'background-color' && item.duration >= 200 && item.duration <= 320), `${label}: shared, restrained color timing`);
  check(result.timing.every(item => item.property === 'background-color'), `${label}: only the carrying color animates`);
  const [start, , middle, , end] = result.colors;
  check(distance(start, middle) > 0 && distance(start, end) >= distance(start, middle), `${label}: real intermediate paint`);
  for (const color of result.colors) {
    check(color[3] === 255, `${label}: opaque carrying plane`);
    check(color.slice(0, 3).every((value, i) => value >= Math.min(start[i], end[i]) && value <= Math.max(start[i], end[i])), `${label}: no color overshoot`);
  }
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(new URL('welcome-cards.html', server.resolvedUrls.local[0]).href);
  await page.locator('[data-card-state="idle"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const preset of builtInShellThemePresets) {
    await page.mouse.move(0, 0);
    await page.evaluate(preset => {
      const root = document.documentElement;
      root.classList.toggle('dark', preset.mode === 'dark');
      root.classList.toggle('light', preset.mode === 'light');
      root.dataset.floeShellTheme = preset.name;
      root.dataset.floeSurfaceStyle = 'soft-neumorphic';
    }, preset);
    await settle(page);
    for (const state of ['idle', 'open', 'new']) {
      const label = `${preset.name}/${state}`, card = page.locator(`[data-card-state="${state}"]`);
      const before = await card.evaluate(read);
      const box = await card.boundingBox();
      await page.mouse.move(box.x + 12, box.y + 12);
      const entering = await paintTransition(card);
      const hover = await card.evaluate(read);
      checkTransition(entering, `${label}/enter`);
      check(before.image === hover.image, `${label}: hover must not replace a gradient discretely`);
      check(before.shadow === hover.shadow && before.border === hover.border, `${label}: no flashing shadow or extra contour`);
      check(JSON.stringify(before.rect) === JSON.stringify(hover.rect) && hover.transform === 'none', `${label}: stable card and child geometry`);
      check(distance(before.color, hover.color) <= 9, `${label}: restrained hover luminance change`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12);
      const inside = await card.evaluate(read);
      check(distance(inside.color, hover.color) === 0 && inside.image === hover.image, `${label}: crossing child regions does not restart paint`);
      await page.mouse.move(0, 0);
      const leaving = await paintTransition(card);
      const after = await card.evaluate(read);
      checkTransition(leaving, `${label}/leave`);
      check(distance(before.color, after.color) === 0 && before.image === after.image, `${label}: returns to the exact resting surface`);
      report.cases.push({ label, before, entering, hover, leaving, after });
    }
    if (['classic-light', 'classic-dark', 'porcelain-light', 'porcelain-dark'].includes(preset.name)) {
      await page.screenshot({ path: `${output}/${preset.name}.png` });
    }
  }
  for (const theme of ['porcelain-light', 'porcelain-dark']) for (const reducedMotion of ['no-preference', 'reduce']) {
    const label = `${theme}/${reducedMotion}`;
    await page.emulateMedia({ reducedMotion });
    await page.evaluate(theme => { document.documentElement.dataset.floeShellTheme = theme; document.documentElement.classList.toggle('dark', theme.endsWith('dark')); }, theme);
    await settle(page);
    const card = page.locator('[data-card-state="open"]');
    const before = await card.evaluate(read);
    // The production relation card changes this class on its existing Card node.
    await card.evaluate(element => element.classList.remove('redeven-environment-card--open'));
    const disconnect = await paintTransition(card);
    await card.evaluate(element => element.classList.add('redeven-environment-card--open'));
    const connect = await paintTransition(card);
    checkTransition(disconnect, `${label}/disconnect`, reducedMotion === 'reduce');
    checkTransition(connect, `${label}/connect`, reducedMotion === 'reduce');
    check(distance(before.color, (await card.evaluate(read)).color) === 0, `${label}: connected tint survives state changes`);
    const box = await card.boundingBox(), frames = [];
    for (let index = 0; index < 6; index++) {
      await page.mouse.move(index % 2 ? 0 : box.x + 12, index % 2 ? 0 : box.y + 12);
      frames.push(await card.evaluate(read));
      await page.waitForTimeout(35);
      frames.push(await card.evaluate(read));
    }
    await settle(page);
    const after = await card.evaluate(read);
    check(frames.every(frame => frame.image === before.image && frame.shadow === before.shadow), `${label}: rapid reversal never swaps material`);
    if (reducedMotion !== 'reduce') check(frames.slice(1).every((frame, i) => distance(frame.color, frames[i].color) <= 4), `${label}: rapid reversal continues from the painted color`);
    check(distance(before.color, after.color) === 0, `${label}: interrupted hover settles exactly`);
    report.systemCases.push({ label, connect, disconnect, frames });
  }
  const load = path => server.ssrLoadModule(fileURLToPath(new URL(path, import.meta.url)));
  const { mixedEnvironmentFixture } = await load('../src/testSupport/mixedEnvironmentFixture.ts');
  const { testLocalEnvironmentSession } = await load('../src/testSupport/desktopTestHelpers.ts');
  const { buildSSHDesktopTarget } = await load('../src/main/desktopTarget.ts');
  const { buildDesktopWelcomeSnapshot } = await load('../src/main/desktopWelcomeState.ts');
  const { inputs, targets } = mixedEnvironmentFixture({ linkState: 'unbound' });
  const ssh = targets[0], target = buildSSHDesktopTarget({ ...ssh.host_access.ssh, ...ssh.placement }, { environmentID: ssh.id, label: ssh.label });
  const snapshot = buildDesktopWelcomeSnapshot({ ...inputs, openSessions: [
    testLocalEnvironmentSession(inputs.preferences.local_environment, 'http://localhost:23998/'),
    { session_key: target.session_key, target, lifecycle: 'open', entry_url: 'http://localhost:23999/' },
  ] });
  const owners = ['local_environment', 'ssh_environment'].map(kind => snapshot.environments.find(entry => entry.kind === kind && entry.is_open));
  assert.ok(owners.every(Boolean), 'fixture includes open Local and SSH sessions');
  for (const width of [1367, 768, 430, 390]) for (const theme of ['porcelain-light', 'porcelain-dark']) {
    const label = `${width}/${theme}`;
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const welcome = await context.newPage();
    welcome.on('pageerror', error => report.errors.push(`${label}: ${error.message}`));
    await welcome.addInitScript(snapshot => {
      window.settingsFixtureSnapshot = snapshot;
      const language = { preference: 'zh-CN', resolved_locale: 'zh-CN', source: 'explicit', system_candidates: [] };
      window.redevenDesktopLanguage = { getSnapshot: () => language, setPreference: () => language, subscribe: () => () => {} };
    }, snapshot);
    await welcome.goto(new URL('environment-settings.html', server.resolvedUrls.local[0]).href);
    await welcome.locator('[data-environment-group]').first().waitFor();
    await welcome.evaluate(async theme => {
      document.documentElement.dataset.floeShellTheme = theme;
      document.documentElement.classList.toggle('dark', theme.endsWith('dark'));
      document.documentElement.classList.toggle('light', theme.endsWith('light'));
      await document.fonts.ready;
    }, theme);
    await welcome.waitForTimeout(350);
    for (const owner of owners) {
      const card = welcome.locator('[data-environment-group]').filter({ has: welcome.locator(`[data-owner-id="${owner.id}"]`) });
      await card.scrollIntoViewIfNeeded();
      await welcome.mouse.move(0, 0); await settle(welcome);
      const resting = await card.evaluate(read), box = await card.boundingBox();
      check(await card.evaluate(element => element.classList.contains('redeven-environment-card--open')), `${label}/${owner.kind}: actual connected card is exercised`);
      await welcome.mouse.move(box.x + 14, box.y + 14);
      const enter = await paintTransition(card), hovered = await card.evaluate(read);
      checkTransition(enter, `${label}/${owner.kind}/hover`);
      check(resting.image === 'none' && hovered.image === 'none' && hovered.color[3] === 255, `${label}/${owner.kind}: connected material remains opaque`);
      if (width === 1367) await card.screenshot({ path: `${output}/hover-${theme}-${owner.kind}.png` });
      const button = card.locator('.redeven-split-action-primary button:visible');
      await button.hover();
      check(distance(hovered.color, (await card.evaluate(read)).color) === 0, `${label}/${owner.kind}: entering child action retains card paint`);
      await button.focus();
      await welcome.evaluate(value => window.settingsFixture.publish(structuredClone(value)), snapshot);
      check(await button.evaluate(element => document.activeElement === element), `${label}/${owner.kind}: refresh retains focused action`);
      await button.press('Enter');
      check(await welcome.evaluate(session => window.settingsFixture.requests.some(request => request.session_key === session && request.kind === 'focus_environment_window'), owner.open_session_key), `${label}/${owner.kind}: keyboard action reaches its existing session`);
      report.welcomeCases.push({ label, owner: owner.kind, resting, hovered, enter });
    }
    await welcome.mouse.move(0, 0); await welcome.waitForTimeout(350);
    await welcome.locator('[data-environment-group]').first().scrollIntoViewIfNeeded();
    await welcome.screenshot({ path: `${output}/welcome-${width}-${theme}.png`, fullPage: true });
    check(await welcome.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no horizontal overflow`);
    await context.close();
  }
  // Touch must not latch desktop hover; forced colors retain a system boundary.
  for (const mode of ['touch', 'forced-colors']) {
    const context = await browser.newContext(mode === 'touch' ? { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } } : { forcedColors: 'active', reducedMotion: 'reduce' });
    const system = await context.newPage();
    await system.goto(new URL('welcome-cards.html', server.resolvedUrls.local[0]).href);
    const card = system.locator('[data-card-state="open"]'); await card.waitFor();
    await settle(system); const before = await card.evaluate(read);
    if (mode === 'touch') await card.tap(); else await card.hover();
    await settle(system); const after = await card.evaluate(read);
    check(distance(before.color, after.color) === 0 && before.image === after.image, `${mode}: no sticky or decorative card hover`);
    if (mode === 'forced-colors') check(before.border !== (await card.evaluate(element => getComputedStyle(element).backgroundColor)), `${mode}: system boundary remains visible`);
    report.systemCases.push({ mode, before, after });
    await context.close();
  }
  check(report.errors.length === 0, 'no browser runtime errors');
  report.status = report.failures.length ? 'failed' : 'passed';
  assert.deepEqual(report.failures, [], `Welcome card hover failures (${report.failures.length})`);
  console.log(`Welcome card hover passed: ${report.cases.length} palette/state, ${report.systemCases.length} system/reversal and ${report.welcomeCases.length} real Welcome cases.`);
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
