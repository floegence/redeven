import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {afterEach, describe, expect, it, vi} from 'vitest';
const {JSDOM}=createRequire(import.meta.url)('jsdom') as {JSDOM:new(html:string,options:Record<string,unknown>)=>{window:Window & typeof globalThis}};
const root=resolve(process.cwd(),'../../codeapp/appserver/host_application_viewer');
const source=['catalog.generated.js','viewport.generated.js','remote-input.generated.js','remote-pointer.generated.js','appearance.js','connection.js','toolbar.js','canvas.js','linux.js'].map(name=>readFileSync(resolve(root,name),'utf8')).join('\n');
const html=readFileSync(resolve(root,'viewer.html'),'utf8').split('<script nonce=')[0].replace('{{.Style}}','').replace('{{.Locale}}','en-US');
let dom:InstanceType<typeof JSDOM>;
const drain=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
afterEach(()=>{dom?.window.dispatchEvent(new dom.window.Event('beforeunload'));dom?.window.close();});
async function viewer(platform='Linux x86_64') {
  dom=new JSDOM(html,{url:'http://localhost/pf/test/_redeven_host_app/',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window;
  Object.defineProperty(w.navigator,'platform',{value:platform});
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({state:'running',password:'fixture'})});
  const bitmap=vi.fn().mockResolvedValue({width:640,height:480,close:vi.fn()});
  vi.spyOn(w.HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  const native={request:vi.fn()};
  type Message={id:number;method:string;operation?:{kind:string;code?:number;pressed?:boolean;text?:string;dy?:number};connection?:number;window?:number;generation?:number};
  class Socket {
    static OPEN=1;static instances:Socket[]=[];readyState=1;messages:Message[]=[];
    onmessage?:(event:{data:unknown})=>void;onclose?:()=>void;
    constructor(){Socket.instances.push(this);}
    send(raw:string){this.messages.push(JSON.parse(raw));} close(){this.readyState=3;}
    message(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
    state(generation=1,window=1){this.message({event:'state',connection:1,state:{state:'running',window,generation,windows:[{window,parent:0,title:'Native document'}]}});}
    frame(generation=1,window=1){this.message({event:'frame',bytes:3,frame:{encoding:'png',sequence:1,connection:1,window,generation,width:640,height:480}});this.onmessage?.({data:new w.ArrayBuffer(3)});}
  }
  Object.assign(w,{TextDecoder,TextEncoder,fetch,WebSocket:Socket,createImageBitmap:bitmap,redevenHostApplicationWindow:native,matchMedia:()=>({matches:false})});
  w.eval(`class FloeRemoteCursor {reset(){}hide(){}receive(){}dispose(){}}\nconst config=${JSON.stringify({base:'/pf/test',backend:'wayland',copy:{packageUnavailable:'The application package runtime is unavailable',controls:'Controls',windows:'Windows',input:'Input',keyboard:'Keyboard',waiting:'Waiting',reconnect:'Reconnect',operationFailed:'Action failed',inputUnavailable:'Input unavailable',quit:'Quit',cancel:'Cancel',touchHelp:'Touch controls'}})};\n${source}`);
  await drain();const socket=()=>Socket.instances.at(-1)!;
  socket().message({event:'attached',version:1,connection:1,state:{state:'running',window:1,generation:1,windows:[{window:1,parent:0,title:'Native document'}]}});
  const input=w.document.querySelector('textarea')!;
  const activate=async()=>{socket().frame();await drain();await new Promise(resolve=>w.requestAnimationFrame(resolve));socket().messages.length=0;};
  const key=(type:string,key:string,code:string,options:Record<string,unknown>={})=>input.dispatchEvent(new w.KeyboardEvent(type,{key,code,bubbles:true,cancelable:true,...options}));
  const text=(text:string)=>{input.dispatchEvent(new w.CompositionEvent('compositionstart'));input.dispatchEvent(new w.CompositionEvent('compositionend',{data:text}));};
  return {w,socket,input,activate,key,text,bitmap,fetch,native,operations:()=>socket().messages.filter(m=>m.method==='input').map(m=>m.operation)};
}
describe('native Linux viewer',()=>{
  it('uses one canvas and editor without unsupported platform controls',async()=>{
    const v=await viewer();await v.activate();expect(v.w.document.querySelectorAll('textarea')).toHaveLength(1);expect(v.w.document.querySelectorAll('#application')).toHaveLength(1);
    expect(v.w.document.querySelector('.mac-app-controls-toggle')).toBeNull();expect(v.w.document.querySelector('.mac-app-menu-toggle')).toBeNull();expect(v.w.document.querySelector('.host-app-identity')).not.toBeNull();
  });
  it('admits consecutive Unicode commits only after paint and binds the target',async()=>{
    const v=await viewer();v.text('before');expect(v.operations()).toEqual([]);await v.activate();v.text('中文👩‍💻');v.text('中文👩‍💻');
    expect(v.operations()).toEqual([{kind:'text',text:'中文👩‍💻'},{kind:'text',text:'中文👩‍💻'}]);expect(v.socket().messages.every(m=>m.connection===1&&m.window===1&&m.generation===1)).toBe(true);
  });
  it('discards decoded pixels from a retired window',async()=>{
    const v=await viewer();let finish:(value:unknown)=>void=()=>{};const close=vi.fn();v.bitmap.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    v.socket().frame();v.socket().state(2,2);finish({width:640,height:480,close});await drain();expect(close).toHaveBeenCalledOnce();expect(v.socket().messages.some(m=>m.method==='frame_ack')).toBe(false);expect(v.input.disabled).toBe(true);
    v.socket().frame(2,2);await drain();expect(v.input.disabled).toBe(false);
  });
  it('preserves physical key release and repeat',async()=>{
    const v=await viewer();await v.activate();v.key('keydown','ArrowLeft','ArrowLeft');v.key('keydown','ArrowLeft','ArrowLeft',{repeat:true});v.key('keyup','ArrowLeft','ArrowLeft');
    expect(v.operations()).toEqual([true,false].map(pressed=>({kind:'key',code:105,pressed})));
  });
  it('finishes a touch scroll before accepting the next hardware wheel',async()=>{
    const v=await viewer();await v.activate();const canvas=v.w.document.querySelector('canvas')!;
    const errors:unknown[]=[];v.w.addEventListener('error',event=>{errors.push(event.error);event.preventDefault();});
    const pointer=(type:string,y:number)=>{
      const event=new v.w.MouseEvent(type,{clientX:100,clientY:y,bubbles:true,cancelable:true});
      Object.defineProperties(event,{pointerType:{value:'touch'},pointerId:{value:1}});canvas.dispatchEvent(event);
    };
    pointer('pointerdown',200);pointer('pointermove',160);pointer('pointerup',160);
    canvas.dispatchEvent(new v.w.WheelEvent('wheel',{clientX:100,clientY:160,deltaY:-30,cancelable:true}));
    await new Promise(resolve=>v.w.setTimeout(resolve,30));
    expect(errors).toEqual([]);
    expect(v.operations().filter(operation=>operation?.kind==='scroll').map(operation=>operation?.dy)).toEqual([40,-30]);
    expect(v.socket().messages.some(message=>message.method==='release_input')).toBe(false);
  });
  it('maps Command copy to Control without duplicate shortcuts',async()=>{
    const v=await viewer('MacIntel');await v.activate();v.key('keydown','Meta','MetaLeft',{metaKey:true});v.key('keydown','c','KeyC',{metaKey:true});v.key('keyup','c','KeyC',{metaKey:true});v.key('keyup','Meta','MetaLeft');
    expect(v.operations()).toEqual([{kind:'key',code:29,pressed:true},{kind:'key',code:46,pressed:true},{kind:'key',code:46,pressed:false},{kind:'key',code:29,pressed:false}]);
  });
  it('uses confirmed text when the client layout differs from the native keymap',async()=>{
    const v=await viewer();await v.activate();v.key('keydown','z','KeyY');v.input.value='z';v.input.dispatchEvent(new v.w.InputEvent('input',{inputType:'insertText',data:'z'}));v.key('keyup','z','KeyY');
    expect(v.operations()).toEqual([{kind:'text',text:'z'}]);
  });
  it('synchronizes a modifier held before input focus and clears it on the next key',async()=>{
    const v=await viewer();await v.activate();v.key('keydown','a','KeyA',{ctrlKey:true});v.key('keyup','a','KeyA',{ctrlKey:true});v.key('keydown','ArrowRight','ArrowRight');v.key('keyup','ArrowRight','ArrowRight');
    expect(v.operations()).toEqual([[29,true],[30,true],[30,false],[29,false],[106,true],[106,false]].map(([code,pressed])=>({kind:'key',code,pressed})));
  });
  it('publishes clipboard before paste without submitting IME text',async()=>{
    const v=await viewer();await v.activate();v.key('keydown','v','KeyV',{ctrlKey:true});const paste=new v.w.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{files:[],getData:()=> 'paste 中文'}});v.input.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);expect(v.operations()).toEqual([{kind:'key',code:29,pressed:true},{kind:'clipboard',text:'paste 中文'},...[[47,true],[47,false]].map(([code,pressed])=>({kind:'key',code,pressed}))]);
  });
  it('does not overwrite the client clipboard with an empty private seat',async()=>{
    const v=await viewer();await v.activate();const writeText=vi.fn();Object.defineProperty(v.w.navigator,'clipboard',{value:{writeText}});
    v.socket().message({event:'clipboard',clipboard:{connection:1,window:1,generation:1,text:''}});
    expect(writeText).not.toHaveBeenCalled();
  });
  it('revokes a failed input attachment and offers an explicit reconnect',async()=>{
    const v=await viewer();await v.activate();v.text('pending');
    const request=v.socket().messages.at(-1)!;
    v.socket().message({id:request.id,error:'CLIPBOARD_UNAVAILABLE'});
    expect(v.w.document.body.dataset.state).toBe('inputUnavailable');expect(v.input.disabled).toBe(true);
    const count=v.socket().messages.length;v.text('late');expect(v.socket().messages).toHaveLength(count);
    expect(v.w.document.querySelector<HTMLButtonElement>('#retry')?.hidden).toBe(false);
    expect(v.native.request).not.toHaveBeenCalled();
  });
  it('keeps capture failure and unknown ends open',async()=>{
    const v=await viewer();await v.activate();v.socket().message({event:'capture_unavailable',code:'CAPTURE_UNAVAILABLE'});expect(v.w.document.body.dataset.state).toBe('captureUnavailable');expect(v.input.disabled).toBe(true);
    v.fetch.mockResolvedValue({ok:true,json:async()=>({state:'ended',end_reason:'unknown'})});await v.socket().onclose?.();await drain();expect(v.w.document.body.dataset.state).toBe('ended');expect(v.native.request).not.toHaveBeenCalled();
  });
  it('closes an established viewer only on explicit application exit',async()=>{
    const v=await viewer();await v.activate();v.fetch.mockResolvedValue({ok:true,json:async()=>({state:'ended',end_reason:'application_exited'})});await v.socket().onclose?.();await drain();expect(v.native.request).toHaveBeenCalledWith('close');
  });
  it('closes only after the current attachment retires its last native window',async()=>{
    const v=await viewer();await v.activate();
    v.socket().message({event:'state',connection:1,state:{state:'waiting',window:0,generation:2,windows:[]}});
    await drain();expect(v.w.document.body.dataset.state).toBe('windowsClosed');expect(v.native.request).toHaveBeenCalledExactlyOnceWith('close');
    expect(v.socket().messages.some(message=>message.method==='terminate')).toBe(false);
  });
  it.each(['before paint','minimized','unavailable','replacement','reconnected'])('keeps %s native windows open',async scenario=>{
    const v=await viewer();if(scenario!=='before paint')await v.activate();
    if(scenario==='reconnected'){
      await v.socket().onclose?.();await drain();v.w.document.querySelector<HTMLButtonElement>('#retry')!.click();await drain();
      v.socket().message({event:'attached',version:1,connection:1,state:{state:'waiting',window:0,generation:2,windows:[]}});
    }else{
      v.socket().message({event:'state',connection:1,state:{state:scenario==='unavailable'?'unavailable':'waiting',window:0,generation:2,
        windows:scenario==='minimized'?[{window:1,parent:0,minimized:true,title:'Native document'}]:[]}});
      if(scenario==='replacement')v.socket().state(3,2);
    }
    await drain();expect(v.native.request).not.toHaveBeenCalled();expect(v.w.document.body.dataset.state).not.toBe('windowsClosed');
  });
  it('keeps package launch failures open with their specific recovery message',async()=>{
    const v=await viewer();v.fetch.mockResolvedValue({ok:true,json:async()=>({state:'failed',error_code:'package_unavailable'})});await v.socket().onclose?.();await drain();
    expect(v.w.document.body.dataset.state).toBe('packageUnavailable');expect(v.w.document.querySelector('#status')?.textContent).toContain('package runtime');expect(v.native.request).not.toHaveBeenCalled();
  });
});
