import canvasJS from '../../../../codeapp/appserver/host_application_viewer/canvas.js?raw';
import { afterEach, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import viewerHTML from '../../../../codeapp/appserver/host_application_viewer/viewer.html?raw';
import viewerCSS from '../../../../codeapp/appserver/host_application_viewer/viewer.css?raw';
import appearanceCSS from '../../../../codeapp/appserver/host_application_viewer/appearance.generated.css?raw';
import inputCSS from '../../../../codeapp/appserver/host_application_viewer/remote-input.generated.css?raw';
import pointerCSS from '../../../../codeapp/appserver/host_application_viewer/remote-pointer.generated.css?raw';
import catalogJS from '../../../../codeapp/appserver/host_application_viewer/catalog.generated.js?raw';
import viewportJS from '../../../../codeapp/appserver/host_application_viewer/viewport.generated.js?raw';
import inputJS from '../../../../codeapp/appserver/host_application_viewer/remote-input.generated.js?raw';
import pointerJS from '../../../../codeapp/appserver/host_application_viewer/remote-pointer.generated.js?raw';
import appearanceJS from '../../../../codeapp/appserver/host_application_viewer/appearance.js?raw';
import connectionJS from '../../../../codeapp/appserver/host_application_viewer/connection.js?raw';
import toolbarJS from '../../../../codeapp/appserver/host_application_viewer/toolbar.js?raw';
import macosJS from '../../../../codeapp/appserver/host_application_viewer/macos.js?raw';
import { enUS } from '../ui/i18n/locales/en-US';

type Command = {action:string; kind?:string; dx?:number; dy?:number; button?:number};
let frame: HTMLIFrameElement;
afterEach(() => frame?.remove());
async function viewer() {
  frame = document.createElement('iframe');
  frame.style.cssText = 'width:640px;height:540px;border:0';
  const fixture = `
    window.requests=[];
    window.fetch=async()=>({ok:true,json:async()=>({state:'running',password:'fixture'})});
    window.WebSocket=class {
      static OPEN=1;readyState=1;
      constructor(){window.fixtureSocket=this;queueMicrotask(()=>this.onopen());}
      send(raw){
        const message=JSON.parse(raw);window.requests.push(message);
        if(message.action!=='resume')return;
        this.onmessage({data:JSON.stringify({type:'window',input_version:1,control:true,window:'one',generation:1,width:640,height:480})});
        const header=new TextEncoder().encode(JSON.stringify({codec:'png',generation:1,frame_id:1}));
        const image=document.createElement('canvas');image.width=640;image.height=480;
        const ctx=image.getContext('2d');ctx.fillStyle='#abc';ctx.fillRect(0,0,640,480);
        const bytes=Uint8Array.from(atob(image.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
        const packet=new Uint8Array(4+header.length+bytes.length);new DataView(packet.buffer).setUint32(0,header.length);
        packet.set(header,4);packet.set(bytes,4+header.length);this.onmessage({data:packet.buffer});
      }
      close(){this.readyState=3;}
    };
  `;
  const copy: Record<string, unknown> = {};
  for (const [key,value] of Object.entries(enUS.hostApplications)) if(typeof value==='string') copy[key.startsWith('mac') ? key[3].toLowerCase()+key.slice(4) : key]=value;
  frame.srcdoc=viewerHTML.replaceAll('{{.Locale}}','en-US').replaceAll('{{.Theme}}','porcelain-light').replaceAll('{{.Name}}','Pointer fixture')
    .replaceAll('{{.Nonce}}','fixture').replace('{{.Style}}',[appearanceCSS,inputCSS,pointerCSS,viewerCSS].join('\n'))
    .replace('{{.Config}}',JSON.stringify({base:location.origin+'/fixture',backend:'macos',copy}))
    .replace('<script src="{{.TransportScript}}"></script>', `<script>${fixture};window.RedevenWindowTransport={create:()=>({fetch:window.fetch,WebSocket:window.WebSocket,dispose(){}})};</script>`)
    .replace('{{.Script}}',[catalogJS,viewportJS,inputJS,pointerJS,appearanceJS,connectionJS,toolbarJS,canvasJS,macosJS].join('\n'));
  document.body.append(frame);
  await expect.poll(()=>frame.contentDocument?.body.dataset.state).toBe('active');
  const doc=frame.contentDocument!;
  const view=frame.contentWindow! as Window & typeof globalThis & {requests:Command[]};
  const canvas=doc.querySelector('canvas')!;
  // Synthetic touch sequences test browser event ordering, not physical capture.
  // Native mouse clicks below still use the browser's actual pointer capture.
  const touch=(type:string,x=220,y=260,id=1)=>{
    canvas.dispatchEvent(new view.PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1}));
  };
  const inputs=()=>view.requests.filter(p=>p.action==='input');
  view.requests.length=0;
  return {doc,view,canvas,touch,inputs};
}

it('delivers native browser mouse clicks once through the shared owner',async()=>{
  const v=await viewer();
  await (commands as unknown as {clickHostApplicationPointer:()=>Promise<void>}).clickHostApplicationPointer();
  expect(v.inputs().filter(p=>p.kind==='down'||p.kind==='up').map(p=>p.kind)).toEqual(['down','up']);
});

it('routes touch movement to both scroll axes without clicking or cancelling composition',async()=>{
  const v=await viewer();
  const captured=new Set<number>();
  v.canvas.setPointerCapture=id=>{captured.add(id);};
  v.canvas.hasPointerCapture=id=>captured.has(id);
  v.canvas.releasePointerCapture=id=>{captured.delete(id);};
  const input=v.doc.querySelector('textarea')!;
  input.dispatchEvent(new v.view.CompositionEvent('compositionstart'));
  v.touch('pointerdown');v.touch('pointermove',205,225);v.touch('pointermove',195,210);v.touch('pointerup',195,210);
  const scroll=v.inputs().filter(p=>p.kind==='scroll');
  expect(scroll.reduce((n,p)=>n+(p.dx??0),0)).toBe(25);
  expect(scroll.reduce((n,p)=>n+(p.dy??0),0)).toBe(50);
  expect(v.inputs().every(p=>p.kind==='scroll')).toBe(true);
  expect(input.dataset.composing).toBe('true');
  const count=v.inputs().length;
  await new Promise(resolve=>v.view.requestAnimationFrame(()=>v.view.requestAnimationFrame(resolve)));
  expect(v.inputs()).toHaveLength(count);
});

it('discards queued touch scroll when help opens and keeps the help local',async()=>{
  const v=await viewer();
  v.canvas.setPointerCapture=()=>{};v.canvas.hasPointerCapture=()=>false;
  v.touch('pointerdown');v.touch('pointermove',200,210);
  v.doc.querySelector<HTMLButtonElement>('.mac-app-help')!.click();
  v.touch('pointerup',200,210);
  await new Promise(resolve=>v.view.requestAnimationFrame(resolve));
  expect(v.inputs().filter(p=>p.kind==='scroll'||p.kind==='down')).toEqual([]);
  expect(v.doc.querySelector<HTMLElement>('.mac-app-touch-help')!.hidden).toBe(false);
});
