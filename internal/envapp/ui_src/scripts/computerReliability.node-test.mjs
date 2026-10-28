import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserComputerPage } from './computerBrowserPage.mjs';
import { createComputerScript } from './redevenComputerScript.mjs';
import { BrowserComputerController } from './computerBrowserController.mjs';
import { chromium } from 'playwright';

function fixture() {
  const nodes = [];
  const add = (role, name, parent) => {
    const node = { nodeId: String(nodes.length + 1), backendDOMNodeId: nodes.length + 1, role: { value: role }, name: { value: name }, childIds: [], ...(parent ? { parentId: parent.nodeId } : {}) };
    nodes.push(node); parent?.childIds.push(node.nodeId); return node;
  };
  const transport = { send: async (method, args) => {
    if (method === 'Accessibility.getFullAXTree') return { nodes };
    if (method === 'DOM.describeNode') return { node: { nodeName: 'DIV' } };
    if (method === 'Accessibility.getPartialAXTree') return { nodes: nodes.filter(node => node.backendDOMNodeId === args.backendNodeId) };
    return { documents: [], strings: [] };
  } };
  const page = new BrowserComputerPage(transport);
  const frame = { session: transport, frame: { id: 'fixture' }, revision: page.revision };
  page.observedFrames.set('fixture', frame);
  page.frames = async () => [frame];
  return { page, add };
}

test('unique selectors search beyond observation limits and still reject late duplicates', async () => {
  const { page, add } = fixture();
  const root = add('RootWebArea', 'Large page');
  for (let i = 0; i < 1400; i++) add('button', 'Item ' + i, root);
  add('searchbox', 'Domain search', root);
  assert.equal((await page.observe()).truncated, true);
  const selected = await page.resolve({ role: 'searchbox', name: 'Domain search', exact: true });
  assert.equal(selected.name, 'Domain search');
  add('searchbox', 'Domain search', root);
  await assert.rejects(page.resolve({ role: 'searchbox', name: 'Domain search', exact: true }), /AMBIGUOUS_ELEMENT/);
  await assert.rejects(page.resolve({ role: 'button', name: 'Absent', exact: true }), /ELEMENT_NOT_FOUND/);
});

test('bounded table observations disclose incomplete children and scoped reads recover them', async () => {
  const { page, add } = fixture();
  const root = add('RootWebArea', 'Accounts');
  const table = add('table', 'Domains', root);
  for (let i = 0; i < 40; i++) {
    const row = add('row', 'Domain ' + i, table);
    for (let j = 0; j < 7; j++) add('cell', 'Value ' + j, row);
  }
  const observed = await page.observe();
  const incomplete = observed.nodes.filter(node => node.role === 'row' && node.child_refs.length < 7);
  assert.ok(incomplete.length);
  assert.ok(incomplete.every(node => node.children_truncated === true));
  const scoped = await page.observe({ root_ref: incomplete[0].ref });
  assert.equal(scoped.truncated, false);
  assert.equal(scoped.nodes[0].child_refs.length, 7);
});

test('guest argument errors are rejected before dispatch with safe diagnostic codes', async () => {
  for (const code of [
    "await ui.getByRole('button', {name:/secret/}).click()",
    "await ui.getByRole('document').scroll('down', 800)",
    "await ui.getByRole('button').waitFor({state:'attached'})",
    "await ui.observe({limit:'200'})",
    "await ui.observe({emit:1})",
    "await ui.key(42)",
    "await ui.drag(1,2,'3',4)",
  ]) {
    const script = await createComputerScript(); let calls = 0;
    try {
      await assert.rejects(script.execute(code, async () => { calls++; return {}; }), error => error.result.diagnostic.code === 'SCRIPT_ARGUMENT_ERROR');
      assert.equal(calls, 0);
    } finally { script.dispose(); }
  }
});

test('guest runtime diagnostics preserve completed operations without exception text', async () => {
  const script = await createComputerScript(); let calls = 0;
  try {
    await assert.rejects(script.execute("await ui.click(1,2); await new Promise(r=>setTimeout(r,1));", async () => { calls++; return {}; }), error => {
      assert.equal(error.result.diagnostic.code, 'SCRIPT_REFERENCE_ERROR');
      assert.equal(error.result.operations, 1); return true;
    });
    await assert.rejects(script.execute("throw new Error('private page secret')", async () => ({})), error => !JSON.stringify(error.result).includes('private page secret'));
    assert.equal(calls, 1);
  } finally { script.dispose(); }
});

test('bounded output and concurrent operations have distinct safe diagnostics', async () => {
  for (const [code, expected] of [
    ["log('x'.repeat(65537))", 'SCRIPT_OUTPUT_LIMIT'],
    ["const wait=ui.observe(); await ui.click(1,2); await wait", 'SCRIPT_CONCURRENT_OPERATION'],
  ]) {
    const script = await createComputerScript();
    try { await assert.rejects(script.execute(code, async () => { await new Promise(resolve => setTimeout(resolve,5)); return {}; }), error => error.result.diagnostic.code === expected); }
    finally { script.dispose(); }
  }
});

test('a maximum-sized semantic snapshot fits inside its script response envelope', async () => {
  const script = await createComputerScript();
  try {
    const result = await script.execute("const value=await ui.observe({emit:false}); log(value.observation.text.length)", async () => ({
      observation: { text: 'x'.repeat(262100) }, url: 'https://example.test/' + 'a'.repeat(100), title: 'Large page', action_executed: false,
    }));
    assert.deepEqual(result.logs, [[262100]]);
  } finally { script.dispose(); }
});

test('download cursors exclude earlier files and reject ambiguous new downloads', async () => {
  const { page } = fixture();
  page.recordDownload({ id: 'old', filename: 'same.csv', state: 'completed' });
  const { cursor } = page.downloadCursor();
  assert.equal((await page.waitForDownload({ after: cursor, timeout_ms: 0 })).state, 'timeout');
  page.recordDownload({ id: 'new', filename: 'same.csv', state: 'completed' });
  assert.equal((await page.waitForDownload({ after: cursor, timeout_ms: 0 })).download.id, 'new');
  page.recordDownload({ id: 'second', filename: 'same.csv', state: 'completed' });
  await assert.rejects(page.waitForDownload({ after: cursor, timeout_ms: 0 }), /AMBIGUOUS_DOWNLOAD/);
  await assert.rejects(page.waitForDownload({ timeout_ms: 0 }), /INVALID_REQUEST/);
});

test('browser clicks reject covered or disabled controls and wait for rendered visibility', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage();
    await tab.setContent('<button disabled>Disabled</button><button id=save>Save</button><div id=cover style="position:fixed;inset:0;background:white"></div><button style="opacity:0">Transparent</button>');
    const controller = new BrowserComputerController(await tab.context().newCDPSession(tab));
    await controller.initialize();
    const call = args => controller.execute({ tool_name: 'computer.action', args, script_operation: true });
    const disabled = await call({ action: 'click', selector: { role: 'button', name: 'Disabled', exact: true } });
    assert.equal(disabled.error, 'ELEMENT_NOT_ACTIONABLE');
    assert.equal(disabled.result.action_executed, false);
    const covered = await call({ action: 'click', selector: { role: 'button', name: 'Save', exact: true } });
    assert.equal(covered.error, 'ELEMENT_NOT_ACTIONABLE');
    assert.equal(covered.result.action_executed, false);
    assert.equal(covered.result.needs_observation, true);
    const invisible = await call({ action: 'wait', selector: { role: 'button', name: 'Transparent' }, timeout_ms: 0 });
    assert.equal(invisible.result.state, 'timeout');
    await tab.locator('#cover').evaluate(node => node.remove());
    const clicked = await call({ action: 'click', selector: { role: 'button', name: 'Save', exact: true } });
    assert.equal(clicked.error, undefined, JSON.stringify(clicked));
  } finally { await browser.close(); }
});

test('click actionability checks the dispatched center of partly clipped controls', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage();
    await tab.setContent('<button style="position:fixed;left:-200px;top:20px;width:300px;height:80px" onclick="document.title=String(Number(document.title||0)+1)">Clipped</button>');
    const controller = new BrowserComputerController(await tab.context().newCDPSession(tab));
    await controller.initialize();
    const result = await controller.execute({ tool_name: 'computer.action', args: { action: 'click', selector: { role: 'button', name: 'Clipped', exact: true } }, script_operation: true });
    assert.equal(result.error, 'ELEMENT_NOT_ACTIONABLE');
    assert.equal(result.result.action_executed, false);
    assert.equal(await tab.title(), '');
  } finally { await browser.close(); }
});

test('frame clicks use input coordinates and reject an overlay in the parent document', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage();
    await tab.setContent('<iframe style="margin:100px" srcdoc="<button onclick=&quot;document.title=String(Number(document.title||0)+1)&quot;>Nested</button>"></iframe>');
    await tab.frameLocator('iframe').locator('button').waitFor();
    const controller = new BrowserComputerController(await tab.context().newCDPSession(tab));
    await controller.initialize();
    const click = () => controller.execute({ tool_name: 'computer.action', args: { action: 'click', selector: { role: 'button', name: 'Nested', exact: true } }, script_operation: true });
    assert.equal((await click()).error, undefined);
    assert.equal(await tab.frames()[1].title(), '1');
    await tab.evaluate(() => { const cover = globalThis.document.createElement('div'); cover.style = 'position:fixed;inset:0;background:white'; globalThis.document.body.append(cover); });
    const covered = await click();
    assert.equal(covered.error, 'ELEMENT_NOT_ACTIONABLE');
    assert.equal(covered.result.action_executed, false);
    assert.equal(await tab.frames()[1].title(), '1');
  } finally { await browser.close(); }
});
