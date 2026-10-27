import assert from 'node:assert/strict';
import test from 'node:test';
import { createComputerDownloadReader } from './computerDownloadReader.mjs';

test('sequential download chunks open one stream and preserve exact bytes', async () => {
  const content = Buffer.alloc(1024*1024, 117); let opens=0,closed=0;
  const file={state:{id:'exact',filename:'same.csv',status:'complete',size:content.length},async open(signal){opens++;return (async function*(){try {for(let p=0;p<content.length;p+=16384){signal.throwIfAborted();yield content.subarray(p,p+16384);}}finally{closed++;}})();}};
  const page={listeners:new Set()},reader=createComputerDownloadReader({downloads:()=>[file]},page);
  try {
    const chunks=[];let offset=0;
    for(;;){const r=await reader.read({id:'exact',offset,limit:65536});chunks.push(Buffer.from(r.base64,'base64'));if(!r.truncated)break;offset=r.next_offset;}
    assert.deepEqual(Buffer.concat(chunks),content);assert.equal(opens,1);assert.equal(closed,1);
    assert.equal((await reader.read({id:'exact',offset:10,limit:3})).base64,content.subarray(10,13).toString('base64'));
    assert.equal(opens,2);
  }finally{reader.close();}
  assert.equal(page.listeners.size,0);
});

test('download cancellation and inconsistent source size never report completion', async () => {
  for(const mode of ['cancel','short','oversize','retired']){
    const page={listeners:new Set()},files=[];let aborted=false;
    const file={state:{id:'x',filename:'x',status:'complete',size:mode==='short'?5:3},async open(signal){signal.addEventListener('abort',()=>{aborted=true});return (async function*(){if(mode==='cancel'){page.operationCancelled=true;for(const changed of page.listeners)changed();}if(mode==='retired')files.pop();yield Buffer.from(mode==='oversize'?'abcd':'abc');})();}};
    files.push(file);const reader=createComputerDownloadReader({downloads:()=>files},page);
    try{await assert.rejects(reader.read({id:'x'}));assert.equal(aborted,true);}finally{reader.close();}
  }
});
