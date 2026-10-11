/* global window, document, requestAnimationFrame, cancelAnimationFrame, MutationObserver, DOMMatrix, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.argv[2] ?? '/tmp/redeven-tessiven-pan');
const counts = (process.argv[3] ?? '100,500,1000').split(',').map(Number);
const fixture = await mkdtemp(path.join(root, '.pan-'));
const report = { cases: [], errors: [] };
let server, browser;
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.floor(values.length * ratio)] ?? 0;
try {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="./main.tsx"></script>');
  await writeFile(path.join(fixture, 'main.tsx'), `
import { render } from 'solid-js/web';
import { createSignal, Show } from 'solid-js';
import '../src/index.css';
import '../../../tessiven_ui/src/tessiven.css';
import { TessivenGraph } from '../../../tessiven_ui/src/TessivenGraph';
import { tessivenText } from '../../../tessiven_ui/src/i18n';
import { scaleDocument } from '../src/styles/tessiven-scale.fixture';
function App() {
 const [version,setVersion] = createSignal();
 let control, scale=1;
 window.loadGraph=(count)=>{setVersion(undefined); requestAnimationFrame(()=>setVersion({canvas_id:'pan',number:1,document:scaleDocument(count,true)}))};
 window.zoomGraph=()=>{const rect=[...document.querySelectorAll('.tessiven-node')].map(node=>node.getBoundingClientRect()).find(rect=>rect.left>=0&&rect.top>=0&&rect.right<innerWidth&&rect.bottom<innerHeight); const x=rect.x+rect.width/2,y=rect.y+rect.height/2;control.zoom(1/scale,x,y,720-x,460-y)};
 return <div class="tessiven" style={{height:'calc(100vh - 16px)',width:'calc(100vw - 16px)'}}><Show when={version()}>{v=><TessivenGraph version={v()} historical={false} t={tessivenText('en-US')} onAsk={()=>{}} onInspect={()=>{}} onViewportControl={value=>control=value} onZoomChange={value=>scale=value}/>}</Show></div>
}
render(()=><App/>,document.getElementById('root'));`);
  server = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}${path.basename(fixture)}/`);
  await page.waitForFunction(() => !!window.loadGraph);
  for (const count of counts) {
    await page.evaluate(count => window.loadGraph(count), count);
    await page.locator('.tessiven-node').first().waitFor({ timeout: 60000 });
    await page.getByRole('status', { name: 'Arranging canvas' }).waitFor({ state: 'hidden', timeout: 60000 });
    for (const mode of ['fit', 'detail']) {
      if (mode === 'detail') await page.evaluate(() => window.zoomGraph());
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        const root = document.querySelector('.floe-infinite-canvas');
        const viewport = root.querySelector('.floe-infinite-canvas__viewport');
        const state = { frames: [], tasks: [], mutations: 0, errors: [], latency: [], previous: 0, pointer: null, origin: null, raf: 0 };
        const observer = new PerformanceObserver(list => state.tasks.push(...list.getEntries().map(entry => entry.duration)));
        observer.observe({type:'longtask'});
        const mutations = new MutationObserver(records => state.mutations += records.filter(record => record.target !== viewport).length);
        mutations.observe(root, { subtree: true, attributes: true, childList: true });
        const down = event => { state.origin = {x:event.clientX,y:event.clientY,transform:new DOMMatrix(getComputedStyle(viewport).transform)}; };
        const move = event => { state.pointer = {x:event.clientX,y:event.clientY,at:performance.now()}; };
        root.addEventListener('pointerdown',down,true);
        root.addEventListener('pointermove',move,true);
        const frame = now => {
          if(state.previous) state.frames.push(now-state.previous);
          state.previous = now;
          if(state.origin && state.pointer) {
            const matrix = new DOMMatrix(getComputedStyle(viewport).transform);
            state.errors.push(Math.hypot(matrix.e-state.origin.transform.e-state.pointer.x+state.origin.x,matrix.f-state.origin.transform.f-state.pointer.y+state.origin.y));
            state.latency.push(Math.max(0,now-state.pointer.at));
          }
          state.raf=requestAnimationFrame(frame);
        }; state.raf=requestAnimationFrame(frame);
        window.finishPan=()=>{
          cancelAnimationFrame(state.raf);observer.disconnect();mutations.disconnect();
          root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointermove',move,true);
          return {...state,origin:undefined,pointer:undefined,raf:undefined,nodes:document.querySelectorAll('.tessiven-node').length};
        };
      });
      const session = process.env.REDEVEN_PAN_TRACE ? await page.context().newCDPSession(page) : undefined;
      if (session) await session.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-v8.cpu_profiler', transferMode: 'ReturnAsStream' });
      // A native pointer gesture across the graph, including over cards.
      const start=await page.evaluate(()=>{for(let y=18;y<800;y+=60)for(let x=18;x<1000;x+=60){const element=document.elementFromPoint(x,y);if(element?.closest('.floe-infinite-canvas')&&!element.closest('button,input,select,textarea,a'))return{x,y}}throw Error('No canvas pan surface')});
      await page.mouse.move(start.x,start.y); await page.mouse.down();
      for (let step = 1; step <= 60; step++) {
        await page.mouse.move(start.x + step * 5, start.y + step * 2);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      const metrics = await page.evaluate(() => window.finishPan());
      if (session) {
        const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve));
        await session.send('Tracing.end'); const { stream } = await complete;
        let trace = ''; for (;;) { const chunk = await session.send('IO.read', { handle: stream }); trace += chunk.data; if(chunk.eof) break; }
        await session.send('IO.close', {handle:stream}); await session.detach();
        await writeFile(path.join(output, `trace-${count}-${mode}.json`), trace);
      }
      const result = { count, mode, nodes: metrics.nodes, mutations: metrics.mutations,
        frameP95: percentile(metrics.frames, .95), frameMax: Math.max(0,...metrics.frames),
        pointerErrorP95: percentile(metrics.errors, .95), latencyP95: percentile(metrics.latency,.95),
        longTaskMax: Math.max(0,...metrics.tasks) };
      report.cases.push(result); console.log(JSON.stringify(result));
      await page.screenshot({path:path.join(output,`pan-${count}-${mode}.png`)});
      assert(metrics.frames.length >= 30, 'Measure at least thirty rendered drag frames');
      assert(result.frameP95 < 32, 'Large canvas drag must stay within the frame budget');
      assert(result.longTaskMax < 100, 'Drag must not produce a hundred-millisecond renderer task');
      assert(result.pointerErrorP95 < 1, 'Canvas transform must follow the pointer without easing');
    }
  }
  assert.deepEqual(report.errors, []);
  report.status='passed';
} finally {
  await writeFile(path.join(output,'report.json'), JSON.stringify(report,null,2));
  await browser?.close(); await server?.close(); await rm(fixture,{recursive:true,force:true});
}
