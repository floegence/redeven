/* global document, window, innerHeight, innerWidth */
// Executed by WKWebView against the built renderer, not an emulated bridge.
export default async function qualifyRelationships() {
  const until = async read => {
    for (let i = 0; i < 600; i++) {
      if (read()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const panel = document.querySelector('.tessiven-popup');
    throw Error(`Native relationship state timed out: ${read.toString()}\n${JSON.stringify({
      bounds: panel?.getBoundingClientRect().toJSON(), viewport: [innerWidth, innerHeight],
      parent: panel?.parentElement?.outerHTML.slice(0, 1200),
    })}\n${document.body.innerText.slice(0, 500)}`);
  };
  const rows = () => [...document.querySelectorAll('[data-relation-summary]')];
  const button = name => [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === name);
  const click = element => { if (!element) throw Error('Native action missing'); element.click(); };
  const command = action => window.serviceCanvas.command({ canvas_id: 'qualification', version_id: 1, action });
  await until(() => rows().length === 2 && !document.querySelector('[aria-label="Arranging canvas"]'));
  for (const row of rows()) if (row.getAttribute('data-relation-count') !== '1000') throw Error('Native count is not exact');
  click(rows()[0]);
  await until(() => document.querySelectorAll('[data-exact-relation-id]').length === 50);
  for (let i = 0; i < 19; i++) click(button('Next page'));
  if (!document.querySelector('[data-exact-relation-id="host-999-agent-call"]')) throw Error('Last native relationship missing');
  const search = document.querySelector('[aria-label="Search nodes or endpoints"]');
  search.value = 'host-999'; search.dispatchEvent(new Event('input', { bubbles: true }));
  await until(() => document.querySelectorAll('[data-exact-relation-id]').length === 1);
  click(document.querySelector('[data-exact-relation-id="host-999-agent-call"]'));
  await until(() => !document.querySelector('.tessiven-popup'));
  for (let i = 0; i < 3; i++) {
    command('expand');
    await until(() => document.querySelector('.tessiven-node-selector select') && !document.querySelector('[aria-label="Arranging canvas"]'));
    const selector = document.querySelector('.tessiven-node-selector select');
    selector.value = 'host-999'; selector.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => document.querySelectorAll('[data-node-id="host-999"] [data-relation-id]').length === 2);
    if (document.querySelectorAll('.tessiven-pool-relations').length !== 1) throw Error('Unstable native pool overview');
    command('collapse');
    await until(() => rows().length === 2 && !document.querySelector('[aria-label="Arranging canvas"]'));
  }
  click(button('Fit canvas'));
  click(rows()[0]);
  await until(() => {
    const panel = document.querySelector('.tessiven-popup')?.getBoundingClientRect();
    return panel && panel.top >= 0 && panel.bottom <= innerHeight;
  });
  if (document.querySelectorAll('[data-exact-relation-id]').length !== 50) throw Error('Unbounded native detail DOM');
  if (document.querySelector('[role="alert"]')) throw Error('Native canvas alert');
  return { patterns: 2, originalRelations: 2000, pageSize: 50, lastOriginal: 'host-999-agent-call', compactCycles: 3, viewport: [innerWidth, innerHeight] };
}
