/* global Element, getComputedStyle, innerHeight, innerWidth, HTMLInputElement, HTMLTextAreaElement, getSelection, document, NodeFilter, ClipboardItem */
import { createHash } from 'node:crypto';
import { evaluate, evaluationValue } from './computerBrowserEvaluation.mjs';

// Source reads remain in the existing page/document/reference owner. Cursors
// fingerprint complete source values; no persistent snapshot or shadow DOM.
export function sourcePage(value, identity, {limit=12000,cursor}={}, metadata={}) {
  const encoding=typeof value==='string'?'text':'json';
  const full=encoding==='text'?value:JSON.stringify(value);
  const characters=Array.from(full);
  const hash=createHash('sha256').update(JSON.stringify(identity)).update(full).digest('hex');
  let offset=0;
  if(cursor!==undefined){const parts=cursor.split(':');if(parts.length!==2||parts[0]!==hash||!/^\d+$/u.test(parts[1]))throw new Error('STALE_REFERENCE');offset=Number(parts[1]);if(!Number.isSafeInteger(offset)||offset>characters.length)throw new Error('STALE_REFERENCE');}
  let end=offset,bytes=0;
  while(end<characters.length&&end-offset<limit){const size=Buffer.byteLength(JSON.stringify(characters[end]));if(bytes+size>48000)break;bytes+=size;end++;}
  const truncated=end<characters.length;
  return {...metadata,value:characters.slice(offset,end).join(''),encoding,offset,total:characters.length,unit:'unicode_code_points',truncated,...(truncated?{next_cursor:hash+':'+end}:{})};
}

export async function withDOM(page,element,fn,args=[],mutates=false){
  const session=element.frame.session;
  const {executionContextId}=await session.send('Page.createIsolatedWorld',{frameId:element.frame.frame.id,worldName:'flower-observation'});
  const {object}=await session.send('DOM.resolveNode',{backendNodeId:element.backendNodeId,executionContextId});
  try{
    const params={objectId:object.objectId,functionDeclaration:fn.toString(),arguments:args.map(value=>({value})),returnByValue:true};
    const checked=raw=>{
      const result=evaluationValue(raw,'Runtime.callFunctionOn',value=>value!==undefined);
      if(result?.unsupported)throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
      if(result?.ambiguous)throw new Error('AMBIGUOUS_ELEMENT');
      if(result?.invalid)throw new Error('INVALID_REQUEST');
      if(result?.protected)throw new Error('TAKEOVER_REQUIRED');
      return result;
    };
    if(mutates)checked(await session.send('Runtime.callFunctionOn',{...params,arguments:[...params.arguments,{value:true}]}));
    const result=mutates?await page.effect(async()=>checked(await session.send('Runtime.callFunctionOn',params))):checked(await session.send('Runtime.callFunctionOn',params));
    return result;
  }finally{if(object.objectId)await session.send('Runtime.releaseObject',{objectId:object.objectId});}
}

export async function browserSource(page,element,args){
  const source=args.source??'ax',document_id=page.prefix+':'+page.revision;
  const metadata={source:source==='ax'?'browser_accessibility':'browser_dom',document_id,ref:element.ref};
  if(source==='dom'&&!element.backendNodeId)throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
  const privacyElement=element.backendNodeId?element:{...element,backendNodeId:element.privacyBackendNodeId};
  if(!privacyElement.backendNodeId)throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
  // Explicit source access includes hidden descendants; protect credentials in
  // that exact subtree before reading attributes or values, including shadow DOM.
  await withDOM(page,privacyElement,function(){
    const roots=[this];
    for(let i=0;i<roots.length;i++){
      const root=roots[i];
      if(root instanceof Element&&root.matches('input[type="password"],input[autocomplete~="one-time-code"]'))return {protected:true};
      for(const child of root.querySelectorAll?.('*')??[]){
        if(child.matches('input[type="password"],input[autocomplete~="one-time-code"]'))return {protected:true};
        if(child.shadowRoot)roots.push(child.shadowRoot);
      }
    }
    return {checked:true};
  });
  const sourceNode=(await element.frame.session.send('DOM.describeNode',{backendNodeId:privacyElement.backendNodeId,depth:['textContent','innerText'].includes(args.field)?-1:0,pierce:true})).node;
  const check=[sourceNode];let visited=0;
  while(check.length){
    if(++visited>100000)throw new Error('TARGET_OBSERVATION_UNAVAILABLE');
    const node=check.pop(),attributes=new Map();
    for(let i=0;i<(node.attributes??[]).length;i+=2)attributes.set(node.attributes[i].toLowerCase(),node.attributes[i+1]);
    if(node.nodeName==='INPUT'&&((attributes.get('type')??'').toLowerCase()==='password'||(attributes.get('autocomplete')??'').toLowerCase().split(/\s+/u).includes('one-time-code')))throw new Error('TAKEOVER_REQUIRED');
    check.push(...node.children??[],...node.shadowRoots??[]);
  }
  let values;
  if(source==='ax'){
    let node,nodes;
    if(element.sourceAX)({node,nodes}=await page.readAXSource(element));
    else {
      ({nodes}=await element.frame.session.send('Accessibility.getPartialAXTree',{backendNodeId:element.backendNodeId,fetchRelatives:true}));
      node=nodes.find(n=>n.backendDOMNodeId===element.backendNodeId);
    }
    if(!node)throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
    values={...node};
    if(args.field==='child_refs'){
      const children=node.childIds?.length?(await element.frame.session.send('Accessibility.getChildAXNodes',{id:node.nodeId,frameId:element.frame.frame.id})).nodes:[];
      const byID=new Map(children.map(n=>[n.nodeId,n]));
      values.child_refs=(node.childIds??[]).map(id=>{
        const child=byID.get(id);if(!child)throw new Error('TARGET_OBSERVATION_UNAVAILABLE');return child;
      });
    }else values.child_refs=[];
    metadata.child_source='ax';
    const parent=nodes.find(n=>n.nodeId===node.parentId);if(parent)values.parent_ref=page.rememberAXSource(element.frame,parent,element).ref;
  }else{
    const {node}=await element.frame.session.send('DOM.describeNode',{backendNodeId:element.backendNodeId,depth:1,pierce:true});
    values={nodeName:node.nodeName,nodeType:node.nodeType,nodeValue:node.nodeValue,childNodeCount:node.childNodeCount??0};
    for(let i=0;i<(node.attributes??[]).length;i+=2)values['attribute:'+node.attributes[i]]=node.attributes[i+1];
    const children=[...(node.children??[]),...(node.shadowRoots??[])];
    values.child_refs=children;
    metadata.child_source='dom';
    const properties=['textContent','innerText','value','hidden','offscreen'];
    if(!args.field)return { ...metadata,fields:[...Object.keys(values),...properties],truncated:false };
    if(properties.includes(args.field))values[args.field]=await withDOM(page,element,function(field){
      if(field==='hidden')return this instanceof Element?getComputedStyle(this).display==='none'||getComputedStyle(this).visibility==='hidden':null;
      if(field==='offscreen'){if(!(this instanceof Element))return null;const r=this.getBoundingClientRect();return r.bottom<0||r.right<0||r.top>innerHeight||r.left>innerWidth;}
      return typeof this[field]==='string'?this[field]:null;
    },[args.field]);
  }
  if(!args.field)return {...metadata,fields:Object.keys(values),truncated:false};
  if(!Object.hasOwn(values,args.field))return {...metadata,field:args.field,available:false,truncated:false};
  // CDP represents URL properties as nested AXValue objects. Redact only
  // credential components of identified URL fields, retaining query/fragment.
  let redacted=false;
  const cleanURL=value=>{try{const url=new URL(value,'https://flower.invalid');if(url.username||url.password){url.username='';url.password='';redacted=true;return value.startsWith('//')?url.href.slice(url.protocol.length):url.href;}}catch{ /* Preserve non-URL source values. */ }return value;};
  const cleanAX=(value,urlField=false)=>{
    if(typeof value==='string')return urlField?cleanURL(value):value;
    if(Array.isArray(value))return value.map(v=>cleanAX(v,urlField));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,cleanAX(v,key==='value'&&(urlField||value.name==='url'||value.type==='url'))]));
    return value;
  };
  if(source==='dom'&&['attribute:href','attribute:src','attribute:action','attribute:formaction','attribute:poster','attribute:cite','attribute:data'].includes(args.field)&&typeof values[args.field]==='string')values[args.field]=cleanURL(values[args.field]);
  if(source==='ax'&&args.field!=='child_refs')values[args.field]=cleanAX(values[args.field],args.field==='url');
  if(redacted)metadata.redacted=['url_credentials'];
  if(args.field==='child_refs'){
    const children=values.child_refs,identity=[document_id,element.ref,source,args.field];
    const hash=createHash('sha256').update(JSON.stringify([identity,children.map(n=>[n.backendDOMNodeId??n.backendNodeId,n.nodeId??n.nodeName])])).digest('hex');
    let offset=0;if(args.cursor!==undefined){const parts=args.cursor.split(':');if(parts.length!==2||parts[0]!==hash||!/^\d+$/u.test(parts[1]))throw new Error('STALE_REFERENCE');offset=Number(parts[1]);if(!Number.isSafeInteger(offset)||offset>children.length)throw new Error('STALE_REFERENCE');}
    const end=Math.min(children.length,offset+Math.min(args.limit??100,200));
    const items=children.slice(offset,end).map(n=>source==='ax'?page.rememberAXSource(element.frame,n,element).ref:page.rememberDOMNode(element.frame,n).ref);
    return {...metadata,field:args.field,available:true,items,offset,total:children.length,unit:'items',truncated:end<children.length,...(end<children.length?{next_cursor:hash+':'+end}:{})};
  }
  return sourcePage(values[args.field],[document_id,element.ref,source,args.field],args,{...metadata,field:args.field,available:true});
}

export async function browserSelection(page,element,args){
  if(!element)throw new Error('INVALID_REQUEST');
  const result=await withDOM(page,element,function(args,dryRun=false){
    const input=this instanceof HTMLInputElement||this instanceof HTMLTextAreaElement;
    const editable=input||this.isContentEditable;
    if(input&&this.selectionStart===null)return {unsupported:true};
    const value=input?this.value:this.textContent??'';
    const selection=getSelection();
    const read=()=>{
      if(input)return {start:this.selectionStart,end:this.selectionEnd,direction:this.selectionDirection,text:this.value.slice(this.selectionStart,this.selectionEnd),unit:'utf16_code_units'};
      if(!selection?.rangeCount)return {start:null,end:null,text:'',unit:'utf16_code_units'};
      const range=selection.getRangeAt(0);if(!this.contains(range.startContainer)||!this.contains(range.endContainer))return {start:null,end:null,text:'',unit:'utf16_code_units'};
      const before=document.createRange();before.selectNodeContents(this);before.setEnd(range.startContainer,range.startOffset);
      return {start:before.toString().length,end:before.toString().length+range.toString().length,text:range.toString(),unit:'utf16_code_units'};
    };
    if(args.action==='selection')return read();
    if(args.action==='replace_selection'){
      if(!editable||read().start===null)return {unsupported:true};
      if(dryRun)return {validated:true};
      if(input||this.isContentEditable)this.focus();
      const accepted=document.execCommand('insertText',false,args.text);return {accepted,selection:read(),mechanism:'browser_editing_command'};
    }
    let start=args.start,end=args.end;
    if(args.action==='select_text'){
      const matches=[];let offset=0;
      while(offset<=value.length){const i=value.indexOf(args.text,offset);if(i<0)break;if((args.prefix===undefined||value.slice(0,i).endsWith(args.prefix))&&(args.suffix===undefined||value.slice(i+args.text.length).startsWith(args.suffix)))matches.push(i);offset=i+Math.max(1,args.text.length);}
      if(matches.length!==1)return matches.length?{ambiguous:true}:{unsupported:true};
      start=matches[0];end=start+args.text.length;
      if(args.selection_type==='cursor_before')end=start;
      if(args.selection_type==='cursor_after')start=end;
    }
    if(args.action==='select_all'){start=0;end=value.length;}
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>value.length)return {invalid:true};
    const splitsSurrogate=n=>n>0&&n<value.length&&/[\uD800-\uDBFF]/u.test(value[n-1])&&/[\uDC00-\uDFFF]/u.test(value[n]);
    if(splitsSurrogate(start)||splitsSurrogate(end))return {invalid:true};
    if(dryRun)return {validated:true};
    if(input||this.isContentEditable)this.focus();
    if(input)this.setSelectionRange(start,end,args.direction??'none');
    else{
      const walker=document.createTreeWalker(this,NodeFilter.SHOW_TEXT);const nodes=[];let length=0,n;
      while((n=walker.nextNode())){nodes.push({node:n,start:length});length+=n.length;}
      const locate=offset=>{for(const n of nodes)if(offset<=n.start+n.node.length)return [n.node,offset-n.start];return [this,0];};
      const anchor=locate(args.direction==='backward'?end:start),focus=locate(args.direction==='backward'?start:end);
      selection.setBaseAndExtent(...anchor,...focus);
    }
    return {selection:read(),mechanism:'dom_selection'};
  },[args],args.action!=='selection');
  return args.action==='selection'?{...result,ref:element.ref}:{...result,action_executed:true,execution_mode:'background'};
}

export async function browserEditCommand(page,element,args){
  if(element)await page.focus(element);
  const before=element?await browserSelection(page,element,{action:'selection'}).catch(()=>null):null;
  const frames=element?[element.frame]:await page.frames();
  const frame=element?.frame??frames[0];
  if(args.action==='paste'){
    if(!page.fullAccess)throw new Error('TARGET_PERMISSION_REQUIRED');
    // One native browser editor command, not a synthetic paste event or retry.
    await page.input(frame.session,'Input.dispatchKeyEvent',{type:'rawKeyDown',key:'v',code:'KeyV',commands:['Paste']});
    await page.input(frame.session,'Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV'});
    return {action_executed:true,dispatched:true,mechanism:'browser_editor_command',effect_verified:false,execution_mode:'background'};
  }
  const {executionContextId}=await frame.session.send('Page.createIsolatedWorld',{frameId:frame.frame.id,worldName:'flower-observation'});
  const raw=await page.effect(()=>frame.session.send('Runtime.evaluate',{contextId:executionContextId,expression:'document.execCommand('+JSON.stringify(args.action)+')',returnByValue:true,userGesture:true}));
  const accepted=evaluationValue(raw,'Runtime.evaluate',v=>typeof v==='boolean');
  const after=element?await browserSelection(page,element,{action:'selection'}).catch(()=>null):null;
  return {action_executed:true,accepted,mechanism:'browser_editing_command',effect_verified:false,selection_before:before,selection_after:after,clipboard_effect:accepted?'command_accepted':'not_confirmed',execution_mode:'background'};
}

export async function browserClipboard(page,args){
  if(!page.fullAccess)throw new Error('TARGET_PERMISSION_REQUIRED');
  const frame=(await page.frames())[0];
  const {executionContextId}=await frame.session.send('Page.createIsolatedWorld',{frameId:frame.frame.id,worldName:'flower-observation'});
  const body=async function(operation,items){
    if(!navigator.clipboard)return {unsupported:true};
    try {
    if(operation==='write'){
      const records=items.map(item=>new ClipboardItem(Object.fromEntries(Object.entries(item).map(([type,value])=>[type,new Blob([Uint8Array.from(atob(value),c=>c.charCodeAt(0))],{type})]))));
      await navigator.clipboard.write(records);return {written:true};
    }
    const records=await navigator.clipboard.read();
    if(operation==='types')return {types:records.map(item=>item.types)};
    let size=0;const result=[];
    for(const item of records){const values={};for(const type of item.types){const bytes=new Uint8Array(await (await item.getType(type)).arrayBuffer());size+=bytes.length;if(size>65536)return {unsupported:true};let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);values[type]=btoa(raw);}result.push(values);}
    return {items:result};
    }catch(error){return {permissionDenied:error.name==='NotAllowedError',unsupported:error.name!=='NotAllowedError'};}
  };
  const params={executionContextId,functionDeclaration:body.toString(),arguments:[{value:args.operation},{value:args.items}],returnByValue:true,awaitPromise:true,userGesture:true};
  const result=args.operation==='write'?evaluationValue(await page.effect(()=>frame.session.send('Runtime.callFunctionOn',params)),'Runtime.callFunctionOn',v=>v&&typeof v==='object'):await evaluate(frame.session,'Runtime.callFunctionOn',params,v=>v&&typeof v==='object');
  if(result.permissionDenied)throw new Error('TARGET_PERMISSION_REQUIRED');
  if(result.unsupported)throw new Error('TARGET_CAPABILITY_UNAVAILABLE');
  return {...result,source:'browser_clipboard',scope:'system_clipboard',action_executed:args.operation==='write',mechanism:'clipboard_api'};
}

export async function browserPaste(page,element,args){
  if(!page.fullAccess)throw new Error('TARGET_PERMISSION_REQUIRED');
  if(args.text===undefined&&args.html===undefined)return browserEditCommand(page,element,args);
  const items=[{...(args.text===undefined?{}:{'text/plain':Buffer.from(args.text).toString('base64')}),...(args.html===undefined?{}:{'text/html':Buffer.from(args.html).toString('base64')})}];
  await browserClipboard(page,{operation:'write',items});
  // Browsers expose no pasteboard version: do not restore using a value-only
  // comparison that could overwrite a concurrent identical user copy.
  const result=await browserEditCommand(page,element,args);
  return {...result,clipboard_restored:false,clipboard_restore_supported:false};
}
