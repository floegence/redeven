import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

// Instrument only the qualification page. Measurements start at DOM input and
// finish on the next animation frame after the decoded canvas changes.
export async function installStreamMetrics(page) {
  await page.addInitScript(() => {
    const metrics=window.streamMetrics={bytes:0,painted:0,encoded:0,attachments:0,firstFrame:null,samples:[],stages:[],longTasks:[],pending:null,marker:null,paintScheduled:false,modeRequests:[],queuePeak:0};
    if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{
      for(const entry of list.getEntries())if(metrics.longTasks.length<100)metrics.longTasks.push({start:entry.startTime,duration:entry.duration});
    }).observe({type:'longtask'});
    const Socket=window.WebSocket;
    window.WebSocket=class extends Socket {
      constructor(...args){super(...args);this.addEventListener('message',event=>{
        metrics.bytes+=typeof event.data==='string'?new TextEncoder().encode(event.data).length:event.data.byteLength;
        if(typeof event.data==='string'){
          const value=JSON.parse(event.data);
          if(value.event==='frame')metrics.encoded++;
          if(value.event==='attached')metrics.attachments++;
          if(value.id&&value.id===metrics.pending?.request)metrics.pending.reply=performance.now();
        }
      });}
      send(data){if(typeof data==='string'){
        const value=JSON.parse(data);if(value.method==='configure_stream')metrics.modeRequests.push(value.mode);
        if(value.method==='input'&&value.operation?.kind==='key'&&value.operation.code===57&&value.operation.pressed&&metrics.pending)metrics.pending.request=value.id;
      }super.send(data);}
    };
    document.addEventListener('keydown',event=>{if(event.code==='Space'&&metrics.pending)metrics.pending.start=performance.now();},true);
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(...args){
      draw.apply(this,args);
      if(this.canvas.id!=='application'||metrics.paintScheduled)return;
      metrics.paintScheduled=true;
      requestAnimationFrame(()=>{
        metrics.paintScheduled=false;metrics.painted++;
        if(metrics.firstFrame===null)metrics.firstFrame=performance.now();
        const p=metrics.pending;
        if(p?.start!==null&&p?.start!==undefined&&metrics.marker){
          const [x,y]=metrics.marker,red=this.getImageData(x,y,1,1).data[0];
          if(Math.abs(red-p.expected)<10){
            const now=performance.now();metrics.samples.push(now-p.start);
            metrics.stages.push({start:p.start,submission_reply_ms:p.reply===undefined?null:p.reply-p.start,reply_to_present_ms:p.reply===undefined?null:now-p.reply});metrics.pending=null;
          }
        }
      });
    };
  });
}

export async function checkNativeDesktopStream({page,output,transport}) {
  const input=page.locator('.floe-remote-input'),canvas=page.locator('#application');
  await page.waitForFunction(()=>{
    const c=document.querySelector('#application'),ctx=c.getContext('2d'),pixels=ctx.getImageData(0,0,c.width,c.height).data;
    for(let y=0;y<c.height;y+=4)for(let x=0;x<Math.min(c.width,100);x+=4){const i=(y*c.width+x)*4;
      if(Math.abs(pixels[i]-30)<5&&Math.abs(pixels[i+1]-30)<5&&Math.abs(pixels[i+2]-210)<5){window.streamMetrics.marker=[x+8,y+8];return true;}}
    return false;
  },undefined,{timeout:15000});
  await page.evaluate(()=>{
    const receive=FloeDesktopFrames.prototype.receive;
    FloeDesktopFrames.prototype.receive=function(packet){receive.call(this,packet);window.streamMetrics.queuePeak=Math.max(window.streamMetrics.queuePeak,this.queue.length+(this.job?1:0));};
  });
  const focus=async()=>{
    const p=await canvas.evaluate(c=>{const r=c.getBoundingClientRect(),s=Math.min(r.width/c.width,r.height/c.height),[x,y]=window.streamMetrics.marker;return {x:r.left+(r.width-c.width*s)/2+x*s,y:r.top+(r.height-c.height*s)/2+y*s};});
    await page.mouse.click(p.x,p.y);await input.focus();
  };
  const snapshot=()=>page.evaluate(()=>({bytes:streamMetrics.bytes,painted:streamMetrics.painted,time:performance.now()}));
  const interval=async milliseconds=>{
    const start=await snapshot();await page.waitForTimeout(milliseconds);const end=await snapshot(),seconds=(end.time-start.time)/1000;
    return {seconds,frames:end.painted-start.painted,fps:(end.painted-start.painted)/seconds,payload_bytes:end.bytes-start.bytes,mbps:(end.bytes-start.bytes)*8/seconds/1e6};
  };
  const results=[];let count=0;
  const measureInput=async()=>{
    const before=await snapshot(),sampleStart=await page.evaluate(()=>streamMetrics.samples.length);
    for(let n=0;n<20;n++){
      const expected=30+(++count)%4*50;
      await page.evaluate(expected=>{streamMetrics.pending={expected,start:null};},expected);
      await page.keyboard.press('Space');
      await page.waitForFunction(()=>streamMetrics.pending===null,undefined,{timeout:3000});
    }
    const after=await snapshot(),{samples,stages}=await page.evaluate(start=>({samples:streamMetrics.samples.slice(start),stages:streamMetrics.stages.slice(start)}),sampleStart);
    const ordered=[...samples].sort((a,b)=>a-b);
    return {payload_bytes:after.bytes-before.bytes,latency:{median:(ordered[9]+ordered[10])/2,p95:ordered[18],samples,stages}};
  };
  for(const mode of ['auto','smooth','clarity','data']){
    await page.locator('.mac-app-controls-toggle').click();
    await page.locator(`[data-picture-mode="${mode}"]`).click();
    await page.keyboard.press('Escape');await focus();await page.waitForTimeout(1500);
    const idle=await interval(2000),typing=await measureInput();
    await page.keyboard.press('s');const motion=await interval(5000),motionInput=await measureInput();
    await page.keyboard.press('i');const settled=await interval(1500);
    results.push({mode,idle,motion,settled,typing_payload_bytes:typing.payload_bytes,
      input_to_presented_pixels_ms:typing.latency,motion_input_to_presented_pixels_ms:motionInput.latency});
  }
  const summary=await page.evaluate(()=>({first_frame_ms:streamMetrics.firstFrame,attachments:streamMetrics.attachments,decode_queue_peak:streamMetrics.queuePeak,mode_requests:streamMetrics.modeRequests,client_long_tasks:streamMetrics.longTasks,dimensions:[document.querySelector('#application').width,document.querySelector('#application').height]}));
  // Keep failure evidence too: budgets must diagnose regressions, not erase them.
  await writeFile(path.join(output,'metrics.json'),JSON.stringify({...summary,conditions:`${transport}; DOM input to next painted animation frame; WebSocket payload bytes exclude framing/TLS`,results},null,2));
  // LAN desktop interaction budgets; these are not video or WAN certification.
  for(const result of results){
    assert(result.input_to_presented_pixels_ms.p95<150,`${result.mode}: input p95 exceeded 150 ms`);
    assert(result.motion_input_to_presented_pixels_ms.p95<250,`${result.mode}: input during motion p95 exceeded 250 ms`);
    assert(result.idle.mbps<0.25,`${result.mode}: settled idle exceeded 250 kbps`);
    assert(result.motion.mbps<(result.mode==='smooth'?15:5),`${result.mode}: document motion exceeded bandwidth budget`);
  }
  assert(results.find(r=>r.mode==='smooth').motion.fps>=25,'motion mode must present at least 25 FPS');
  assert(summary.decode_queue_peak<=3,'decode work exceeded the current plus retired target bound');
  assert.equal(summary.attachments,1,'picture modes reconnected the application');
  await page.locator('.mac-app-controls-toggle').click();
  await page.locator('.mac-app-popover').evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished));});
  await page.screenshot({path:path.join(output,'picture-quality.png')});
  await page.keyboard.press('Escape');
  // A controlled presentation fixture verifies loading with the real adapter,
  // CSS and app icon after performance sampling has finished.
  await page.evaluate(()=>hostApplicationConnection.present('waiting'));
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished));});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#application')).opacity==='0');
  assert.equal(await page.locator('#connection').getAttribute('aria-busy'),'true');
  assert(await page.locator('#retry').isHidden());
  assert(await page.locator('#fallback-icon').isHidden(),'application icon overlaps its fallback');
  assert(await page.locator('#icon').isVisible());
  assert.equal(await page.locator('.progress').evaluate(e=>e.getBoundingClientRect().height),3);
  await page.screenshot({path:path.join(output,'waiting.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.progress span').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.reload();await page.waitForFunction(()=>document.body.dataset.state==='active');
  assert.equal(await page.evaluate(()=>streamMetrics.modeRequests[0]),'data','picture preference did not survive reload');
  return {...summary,results};
}
