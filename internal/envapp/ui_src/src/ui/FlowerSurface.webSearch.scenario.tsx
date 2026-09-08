import { expect, vi } from 'vitest';
import type { FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

export async function assertWebSearchSurface() {
 const base = thread({thread_id:'thread-search',title:'Weather'});
 const results = Array.from({length:7},(_,index) => ({title:`Weather ${index+1}`,url:`https://weather.example/${index+1}`,snippet:'Sunny forecast'}));
 const current: FlowerRuntimeCurrentView = {
  thread_id:base.thread_id,activity:'idle',view_version:1,turn_id:'turn-search',run_id:'run-search',last_outcome:'completed',interactions:[],
  items:[
   {id:'user-search',turn_id:'turn-search',run_id:'run-search',ordinal:1,kind:'user',text:'长沙天气'},
   ...[{id:'opaque',payload:{}},{id:'search',payload:{operation:'search',query:'长沙天气',results_provided:true,results}}].map((entry,index) => ({
    id:entry.id,turn_id:'turn-search',run_id:'run-search',ordinal:index+2,kind:'tool' as const,
    activity:{item_id:entry.id,tool_id:entry.id,tool_name:'web_search',kind:'hosted_tool' as const,status:'success' as const,severity:'quiet' as const,needs_attention:false,requires_approval:false,
     presentation:{label:'Web search',renderer:'web_search' as const,payload:entry.payload}},
   })),
  ],
 };
 const summary = applyFlowerRuntimeCurrentView(base,current);
 const runtime=renderSurfaceWithAdapter({...adapter(true),listThreads:vi.fn(async()=>[summary]),loadThread:vi.fn(async()=>({thread:applyFlowerRuntimeCurrentView(summary,current),current}))});
 await waitFor(()=>Boolean(runtime.querySelector(`[data-thread-id="${summary.thread_id}"] button`)));
 (runtime.querySelector(`[data-thread-id="${summary.thread_id}"] button`) as HTMLButtonElement).click();
 await waitFor(()=>Boolean(runtime.querySelector('[data-flower-activity-item-id="opaque"]')));
 const opaque=runtime.querySelector('[data-flower-activity-item-id="opaque"]')!;
 expect(opaque.textContent).toContain('Details not provided');
 expect(opaque.querySelector('[data-flower-disclosure-trigger]')).toBeNull();
 const search=runtime.querySelector('[data-flower-activity-item-id="search"]')!;
 expect(search.textContent).toContain('长沙天气');
 expect(search.textContent).toContain('7 sources');
 (search.querySelector('[data-flower-disclosure-trigger]') as HTMLButtonElement).click();
 await waitFor(()=>search.querySelectorAll('.flower-web-operation li').length===5);
 const link=search.querySelector<HTMLAnchorElement>('.flower-web-operation a')!;
 expect(link.href).toBe('https://weather.example/1');
 expect(link.target).toBe('_blank');
 const more=search.querySelector<HTMLButtonElement>('.flower-web-operation-more')!;
 expect(more.textContent).toContain('Show 2 more');
 more.click();
 expect(search.querySelectorAll('.flower-web-operation li')).toHaveLength(7);
 expect(search.querySelector('[data-flower-disclosure-trigger]')?.getAttribute('aria-expanded')).toBe('true');
 return runtime;
}
