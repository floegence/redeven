/* global AudioContext, document */
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { NativeMediaBridge } from '@floegence/floebrowser';
import { createComputerBrowserSource } from './computerBrowserSource.mjs';
import { createComputerBrowserViews } from './computerBrowserViews.mjs';

async function fixture(t) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const sources = new Map();
  const pages = new Map();
  for (const id of ['one', 'two', 'personal']) {
    const page = await context.newPage();
    await page.goto('data:text/html,<title>' + id + '</title><input>');
    pages.set(id, page);
    sources.set(id, await createComputerBrowserSource(page, id));
  }
  const listeners = new Set();
  const directory = {
    list: () => [...sources].map(([id, owner]) => ({ id, url: owner.source.url() })),
    resolve: async id => sources.get(id)?.source ?? (() => { throw new Error('Source tab is unavailable'); })(),
    downloads: id => sources.get(id)?.source.downloads() ?? [],
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async create() { throw new Error('Creation requires a Runtime directory command'); },
    async close() { throw new Error('Closing requires a Runtime directory command'); },
    async move() {}, async pin() {}, async restore() {},
  };
  const views = await createComputerBrowserViews(directory, { sourceOwner: id => sources.get(id), resourceURL: (id, target) => `?browser_target=${target}&browser_resource=${id}` });
  t.after(async () => {
    await views.close();
    for (const owner of sources.values()) await owner.dispose();
    await browser.close();
  });
  return { views, sources, pages };
}

test('overlapping browser windows output each source audio once and hand it off after closing', { timeout: 20000 }, async t => {
  const browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
  const bridge = new NativeMediaBridge();
  const sources = new Map();
  let views;
  t.after(async () => { await views?.close(); for (const source of sources.values()) await source.dispose(); await bridge.close(); await browser.close(); });
  for (const id of ['one', 'two']) {
    const page = await browser.newPage();
    await page.goto('data:text/html,<audio></audio>');
    await page.evaluate(async () => {
      const context = new AudioContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start(); await context.resume();
      const audio = document.querySelector('audio'); audio.srcObject = destination.stream; await audio.play();
    });
    sources.set(id, await createComputerBrowserSource(page, id));
  }
  views = await createComputerBrowserViews({
    list: () => [...sources].map(([id, owner]) => ({ id, url: owner.source.url() })),
    resolve: async id => sources.get(id)?.source ?? (() => { throw new Error('Source tab is unavailable'); })(),
    downloads: id => sources.get(id)?.source.downloads() ?? [],
    subscribe: () => () => {},
    create: async () => { throw new Error('Not allowed'); }, close: async () => {}, move: async () => {}, pin: async () => {}, restore: async () => {},
  }, { sourceOwner: id => sources.get(id), mediaBridge: bridge, resourceURL: id => `?browser_resource=${id}` });
  const counts = [{ one: 0, two: 0 }, { one: 0, two: 0 }, { one: 0, two: 0 }];
  for (const [index, targets] of [['one'], ['two'], ['one', 'two']].entries()) {
    await views.open(`window-${index}`, targets, () => {}, { audio: true, onMediaFrame: frame => { if (frame.header.track === 'audio') counts[index][frame.header.target]++; } });
    if (index === 2) await views.receive('window-2', '', { type: 'command', id: 1, tab: 'one', epoch: '', action: { kind: 'tab_select', tab: 'two' } });
  }
  const wait = async condition => {
    const deadline = Date.now() + 5000;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(condition(), 'Expected authorized audio did not arrive');
  };
  await wait(() => counts[0].one > 5 && counts[1].two > 5);
  assert.deepEqual(counts[2], { one: 0, two: 0 }, 'An overlapping observer must not duplicate either source audio');
  const stopped = counts[0].one;
  await views.closeView('window-0');
  await wait(() => counts[2].one > 5);
  assert.equal(counts[0].one, stopped, 'The former window stops before the new audio owner starts');
  assert.equal(counts[2].two, 0, 'The other source retains its existing audio owner');
});

async function snapshot(messages) {
  const end = Date.now() + 5000;
  while (!messages.some(message => message.type === 'snapshot') && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
  const message = messages.findLast(message => message.type === 'snapshot');
  assert.ok(message, 'The authorized DOM observation must be ready');
  return message.epoch;
}

test('browser views need exact Runtime control tokens and cannot extend a grant by selecting another tab', { timeout: 20000 }, async t => {
  const { views, pages } = await fixture(t);
  const messages = [];
  await views.open('view', ['one', 'two'], message => messages.push(message), { initialTab: 'one', editable: true, media: false });
  assert.equal(messages.findLast(message => message.type === 'session_access')?.editTabs, true, 'Runtime directory grants must remain independent from page input');
  const epoch = await snapshot(messages);
  assert.deepEqual(views.state('view').tabs.map(tab => tab.id), ['one', 'two']);
  assert.equal(messages.findLast(message => message.type === 'control')?.active, false, 'Tab management must not implicitly grant page input');
  const command = (id, tab, action) => ({ type: 'command', id, tab, epoch, action });
  await assert.rejects(views.receive('view', 'invented', command(1, 'one', { kind: 'text', text: 'forbidden' })), /BROWSER_CONTROL_REVOKED/u);
  assert.equal(await views.acquire('view', 'personal', 'forged'), false);
  assert.equal(await views.acquire('view', 'one', 'lease-one'), true);
  await pages.get('one').locator('input').focus();
  await views.receive('view', 'lease-one', command(2, 'one', { kind: 'text', text: 'authorized' }));
  assert.equal(await pages.get('one').locator('input').inputValue(), 'authorized');
  await views.receive('view', 'lease-one', command(3, 'one', { kind: 'tab_select', tab: 'two' }));
  assert.equal(views.state('view').active, 'two');
  assert.equal(messages.findLast(message => message.type === 'control' && message.target === 'two')?.active, false);
  await assert.rejects(views.receive('view', 'lease-one', command(4, 'two', { kind: 'text', text: 'wrong source' })), /BROWSER_CONTROL_REVOKED/u);
  await views.release('view', 'lease-one');
  await views.closeView('view');
  assert.equal(pages.get('one').isClosed(), false);
  assert.equal(pages.get('two').isClosed(), false);
});

test('private browser control removes other views before input and returns only their explicit source grants', { timeout: 20000 }, async t => {
  const { views, pages } = await fixture(t);
  const first = [], second = [];
  await views.open('private', ['one'], message => first.push(message), { media: false });
  await views.open('observer', ['one', 'two'], message => second.push(message), { media: false });
  await snapshot(first); await snapshot(second);
  const revoked = views.privacy('one', 'private');
  assert.deepEqual(views.state('observer').tabs.map(tab => tab.id), ['two']);
  await revoked;
  assert.equal(await views.acquire('private', 'one', 'secret-input'), true);
  const before = second.length;
  await pages.get('one').locator('input').fill('private text');
  await views.receive('private', 'secret-input', { type: 'resync' });
  assert.equal(second.slice(before).some(message => message.type === 'state' && message.state.id === 'one'), false);
  assert.equal(await views.resource('observer', 'one', 'forged-resource'), undefined);
  await views.closeView('private');
  assert.deepEqual(views.state('observer').tabs.map(tab => tab.id), ['one', 'two']);
  assert.equal(views.state('observer').tabs.some(tab => tab.id === 'personal'), false);
  await views.closeView('observer');
});


test('Runtime release drains pending navigation after the view selects another source', { timeout: 10000 }, async t => {
  const server = http.createServer(() => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { views } = await fixture(t);
  const messages = [];
  await views.open('window', ['one', 'two'], message => messages.push(message));
  await snapshot(messages);
  assert.equal(await views.acquire('window', 'one', 'lease'), true);
  const entered = once(server, 'request');
  const navigation = views.receive('window', 'lease', { type: 'command', id: 1, tab: 'one', epoch: '', action: { kind: 'navigate', url: `http://127.0.0.1:${server.address().port}` } });
  await entered;
  await views.receive('window', 'lease', { type: 'command', id: 2, tab: 'one', epoch: '', action: { kind: 'tab_select', tab: 'two' } });
  await views.release('window', 'lease');
  await Promise.race([
    navigation,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Released lease retained a pending source navigation')), 1000)),
  ]);
});
