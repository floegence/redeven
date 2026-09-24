// Application receipts through the production viewer and published controller.
// Chromium's touch driver exercises browser routing; it is not a physical device.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function checkPointer({page,frame,read,output,waitFor,backend}) {
  const evidence=[];
  const wait=async(check,label)=>{
    await waitFor(()=>check(read()),label);
    evidence.push({label,received:read()});
  };
  await wait(r=>Array.isArray(r.outer),'application ready');
  const inset=read().inset;
  let geometry,point;
  if(backend==='macos'){
    point=async(x,y)=>{
      const state=read();
      geometry=await page.locator('canvas').evaluate(canvas=>{
        const rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/canvas.width,rect.height/canvas.height);
        const width=canvas.width*scale,height=canvas.height*scale;
        return {x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height};
      });
      return {x:geometry.x+x/state.width*geometry.width,y:geometry.y+(y+state.inset)/state.height*geometry.height,id:1};
    };
  } else {
    geometry=await frame.evaluate(()=>{
      const client=window.floeXpraInput.getClient();
      const win=Object.values(client.id_to_window).find(w=>client.floePointer.targetForWindow(w));
      const rect=win.canvas.getBoundingClientRect();
      return {x:rect.x,y:rect.y,scale:client.scale,wid:win.wid,dpr:devicePixelRatio,precise:client.server_precise_wheel};
    });
    const frameRect=await page.locator('#application').boundingBox();
    point=(x,y)=>({x:frameRect.x+geometry.x+x/geometry.scale,y:frameRect.y+geometry.y+(y+inset)/geometry.scale,id:1});
  }
  const cdp=await page.context().newCDPSession(page);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const touch=async(x,y,dx=0,dy=0,hold=0)=>{
    const start=await point(x,y);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
    if(hold)await pause(hold);
    if(dx||dy)for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...start,x:start.x+dx*i/12,y:start.y+dy*i/12}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  await touch(80,250,0,-180);
  await wait(r=>r.outer[1]>0&&r.clicks===0,'swipe on button scrolls without click');
  await pause(250);const stopped=read();await pause(250);
  assert.deepEqual(read().outer,stopped.outer,'scroll stops on release');
  evidence.push({label:'no inertia',received:read()});
  const top=await point(80,220);await page.mouse.move(top.x,top.y);await page.mouse.wheel(0,-2400);
  await wait(r=>r.outer[1]===0,'hardware wheel returns to top');
  await touch(460,260,-240,-160);
  await wait(r=>r.inner[0]>0&&r.inner[1]>0&&r.outer[1]===0,'nested diagonal scroll remains locked');
  await touch(80,250);await wait(r=>r.clicks===1,'tap delivered exactly once');
  await pause(400);await touch(80,250);await touch(80,250);
  await wait(r=>r.clicks===3&&r.doubles>=1,'double tap delivered');
  await touch(80,200,0,0,500);await wait(r=>r.rights>=1,'hold release opens context action');
  const releasesBeforeDrag=read().releases;
  await touch(80,125,120,0,500);await wait(r=>r.drag>30&&(backend!=='macos'||r.releases>releasesBeforeDrag),'hold drag moves control and releases');
  const before=read();
  await page.locator('.mac-app-help').click();
  await page.locator('.mac-app-touch-help').waitFor({state:'visible'});
  assert.deepEqual(read(),before,'local help does not send remote input');
  await page.screenshot({path:path.join(output,'pointer-viewer.png')});
  await writeFile(path.join(output,'pointer.json'),JSON.stringify({geometry,inset,evidence,physicalMobile:false},null,2));
  return evidence.map(v=>v.label);
}
