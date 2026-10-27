import { createHash } from 'node:crypto';
import { argumentFailure } from './computerBrowserArguments.mjs';

// Content quads and Input use the owning CDP session's viewport CSS space.
// DOM.getNodeForLocation instead consumes that session's document CSS space.
// Use its layout viewport, not the top page or a child frame's DOM scrollY.
export async function documentHitPoint(session, x, y) {
  const { cssLayoutViewport: viewport } = await session.send('Page.getLayoutMetrics');
  if (!viewport || ![x,y,viewport.pageX,viewport.pageY].every(Number.isFinite)) throw new Error('TARGET_OBSERVATION_UNAVAILABLE');
  return {x:Math.floor(x+viewport.pageX),y:Math.floor(y+viewport.pageY)};
}

// One bounded anchor per controller. Live viewer captures never replace it.
export async function viewportGeometry(transport) {
  const { cssVisualViewport: v } = await transport.send('Page.getLayoutMetrics');
  if (!v || ![v.clientWidth,v.clientHeight,v.pageX,v.pageY,v.offsetX,v.offsetY,v.scale].every(Number.isFinite) || v.clientWidth <= 0 || v.clientHeight <= 0 || v.scale <= 0) throw new Error('TARGET_OBSERVATION_UNAVAILABLE');
  const {frameTree} = await transport.send('Page.getFrameTree');
  const {executionContextId} = await transport.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'flower-observation'});
  const metrics = await transport.send('Runtime.evaluate',{contextId:executionContextId,expression:'({x:Math.max(0,innerWidth-document.documentElement.clientWidth),y:Math.max(0,innerHeight-document.documentElement.clientHeight)})',returnByValue:true});
  const bars = metrics.result?.value;
  if (metrics.exceptionDetails || !bars || ![bars.x,bars.y].every(Number.isFinite)) throw new Error('TARGET_OBSERVATION_UNAVAILABLE');
  // Native viewport capture includes non-overlay scrollbars. Keep the precise
  // CSS content size from CDP and add only their DOM-measured layout extent.
  return {width:v.clientWidth,height:v.clientHeight,capture_width:v.clientWidth+bars.x/v.scale,capture_height:v.clientHeight+bars.y/v.scale,page_x:v.pageX,page_y:v.pageY,offset_x:v.offsetX,offset_y:v.offsetY,scale:v.scale};
}
export const sameGeometry = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function screenshotGeometry(data, viewport, documentID, targetID) {
  const png = Buffer.from(data,'base64');
  if (png.length < 24 || png.toString('hex',0,8) !== '89504e470d0a1a0a') throw new Error('TARGET_OBSERVATION_UNAVAILABLE');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  if (!width || !height) throw new Error('TARGET_OBSERVATION_UNAVAILABLE');
  const frame = 'computer://' + targetID + '/' + createHash('sha256').update(png).digest('hex');
  return {frame,document_id:documentID,coordinate_space:'image_pixels',image:{width,height},viewport,
    transform:{scale_x:(viewport.capture_width??viewport.width)/width,scale_y:(viewport.capture_height??viewport.height)/height,offset_x:viewport.offset_x,offset_y:viewport.offset_y}};
}
export function imageCoordinates(args, anchor, current, documentID, targetID) {
  if (args.coordinate_space === undefined && args.frame === undefined && args.document_id === undefined) return args;
  if (args.coordinate_space !== 'image_pixels' || typeof args.frame !== 'string' || typeof args.document_id !== 'string' || args.selector) throw argumentFailure('coordinate_space','image_pixels_with_frame');
  if (!anchor || anchor.frame !== args.frame || !args.frame.startsWith('computer://' + targetID + '/') || anchor.document_id !== documentID || args.document_id !== documentID || !sameGeometry(anchor.viewport,current)) throw new Error('STALE_REFERENCE');
  const mapped={...args};
  const pairs=args.action === 'drag' ? [['from_x','from_y'],['to_x','to_y']] : [['x','y']];
  for (const [x,y] of pairs) {
    if (!Number.isFinite(args[x]) || !Number.isFinite(args[y]) || args[x]<0 || args[y]<0 || args[x]>=anchor.image.width || args[y]>=anchor.image.height) throw argumentFailure('coordinates','inside_image');
    mapped[x]=args[x]*anchor.transform.scale_x+anchor.transform.offset_x;
    mapped[y]=args[y]*anchor.transform.scale_y+anchor.transform.offset_y;
  }
  delete mapped.coordinate_space; delete mapped.frame; delete mapped.document_id;
  return mapped;
}
