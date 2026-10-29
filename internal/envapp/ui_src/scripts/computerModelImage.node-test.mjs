import assert from 'node:assert/strict';
import test from 'node:test';
import {screenshotGeometry,imageCoordinates} from './computerBrowserFrame.mjs';
import {createComputerScript} from './redevenComputerScript.mjs';
import {validateBrowserAction} from './computerBrowserArguments.mjs';

test('optimized browser image coordinates preserve original and CSS spaces',()=>{
 const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(5120,16);png.writeUInt32BE(2880,20);
 const viewport={width:2560,height:1440,offset_x:4,offset_y:6};const g=screenshotGeometry(png.toString('base64'),viewport,'doc','target');
 assert.deepEqual(g.model_image,{width:2560,height:1440});
 const args={action:'pointer_click',coordinate_space:'model_pixels',frame:g.frame,document_id:'doc',x:100,y:120};validateBrowserAction(args);
 assert.deepEqual(imageCoordinates(args,g,viewport,'doc','target'),{action:'pointer_click',x:104,y:126});
 assert.deepEqual(imageCoordinates({...args,coordinate_space:'image_pixels'},g,viewport,'doc','target'),{action:'pointer_click',x:54,y:66});
 const drag=imageCoordinates({...args,action:'drag',from_x:100,from_y:120,to_x:200,to_y:240},g,viewport,'doc','target');assert.equal(drag.to_x,204);assert.equal(drag.to_y,246);
 assert.throws(()=>imageCoordinates({...args,x:2560},g,viewport,'doc','target'));
 assert.throws(()=>imageCoordinates(args,g,{...viewport,width:2400},'doc','target'),/STALE_REFERENCE/);
 assert.throws(()=>imageCoordinates(args,g,viewport,'new-document','target'),/STALE_REFERENCE/);
});

for (const browser of [true,false]) test('optimized screenshot handle dispatches immutable model geometry: browser='+browser, async()=>{
 const script=await createComputerScript({browser}); const operations=[];
 try {
  await script.execute("const shot=await ui.screenshot(); shot.frame_geometry.frame='forged'; await shot.click(100,120);",async op=>{
   operations.push(op);return op.action==='screenshot'?{frame_geometry:{frame:'original',document_id:'doc',model_image:{width:2560,height:1440}}}:{};
  });
  assert.deepEqual(operations[1],{action:'pointer_click',x:100,y:120,coordinate_space:'model_pixels',frame:'original',document_id:'doc'});
 } finally {script.dispose();}
});
