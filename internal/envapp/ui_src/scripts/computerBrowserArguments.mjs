import { browserKey } from './computerBrowserKeys.mjs';

// This vocabulary contains product-authored diagnostics only, never page text.
export const argumentFailure = (field, expected) => Object.assign(new Error('INVALID_REQUEST'), {
  diagnostic: { phase: 'validation', field, expected, recovery: 'correct_arguments' },
});
export function validateBrowserAction(args, privateInput = false) {
  const fields = {
    key: ['key', 'selector'], fill: ['text', 'selector'], type: ['text'],
    click: ['selector','button','modifiers','click_count','duration_ms'], pointer_click: ['x','y','button','modifiers','click_count','duration_ms'], double_click: ['x','y'], hover:['selector','x','y'],
    set_files:['selector','files'],source:['selector','source','field','limit','cursor'], capabilities:[], selection:['selector'], select_text:['selector','text','prefix','suffix','selection_type'], select_range:['selector','start','end','direction'], select_all:['selector'], replace_selection:['selector','text'], copy:['selector'],cut:['selector'],paste:['selector','text','html'],clipboard:['operation','items'],input_sequence:['events'],set_value:['selector','value'],perform_action:['selector','name'],
    scroll: ['selector', 'x', 'y', 'delta_x', 'delta_y'],
    drag: ['from_x', 'from_y', 'to_x', 'to_y', 'duration_ms','button','modifiers'],
    wait: ['selector', 'state', 'equals', 'timeout_ms'], query: ['selector', 'limit', 'cursor'], table: ['selector', 'limit', 'cursor'],
    attribute: ['selector', 'attribute'], read: ['selector'], text: ['selector'],
  };
  const allowed = fields[args.action];
  if (!allowed) throw argumentFailure('action', 'supported_action');
  const image = ['coordinate_space', 'frame', 'document_id'];
  if (Object.keys(args).some(key => !['action', 'target', 'description', ...allowed, ...image].includes(key))) throw argumentFailure('arguments', 'documented_fields');
  if (image.some(key => args[key] !== undefined) && (!['pointer_click', 'double_click', 'scroll', 'drag','hover'].includes(args.action) || args.selector || !['image_pixels','model_pixels'].includes(args.coordinate_space) || typeof args.frame !== 'string' || typeof args.document_id !== 'string')) throw argumentFailure('coordinate_space', 'image_pixels_with_frame');
  if (['click', 'fill', 'read', 'query', 'table', 'attribute', 'text', 'wait','source','selection','select_text','select_range','select_all','replace_selection'].includes(args.action) && !args.selector) throw argumentFailure('selector', 'documented_selector');
  if (args.selector !== undefined) {
    const s = args.selector;
    if (!s || Array.isArray(s) || typeof s !== 'object' || Object.keys(s).some(key => !['ref', 'role', 'roles', 'name', 'exact', 'root_ref'].includes(key)) ||
      (s.ref !== undefined && (typeof s.ref !== 'string' || !s.ref)) ||
      (s.ref === undefined && !(typeof s.role === 'string' && s.role || Array.isArray(s.roles) && s.roles.length && s.roles.every(role => typeof role === 'string' && role))) ||
      (s.name !== undefined && typeof s.name !== 'string') || (s.root_ref !== undefined && typeof s.root_ref !== 'string') || (s.exact !== undefined && typeof s.exact !== 'boolean')) throw argumentFailure('selector', 'documented_selector');
  }
  const finite = key => { if (!Number.isFinite(args[key])) throw argumentFailure(key, 'finite_number'); };
  const point = (x,y) => { finite(x); finite(y); if (args[x] < 0 || args[y] < 0) throw argumentFailure('coordinates', 'nonnegative_coordinates'); };
  if(args.button!==undefined&&!['left','right','middle'].includes(args.button))throw argumentFailure('arguments','documented_fields');
  if(args.modifiers!==undefined&&(!Array.isArray(args.modifiers)||args.modifiers.some(x=>!['Alt','Control','Meta','Shift'].includes(x))))throw argumentFailure('arguments','documented_fields');
  if(args.click_count!==undefined&&(!Number.isInteger(args.click_count)||args.click_count<1||args.click_count>3))throw argumentFailure('arguments','documented_fields');
  if(args.duration_ms!==undefined&&(!Number.isInteger(args.duration_ms)||args.duration_ms<0||args.duration_ms>5000))throw argumentFailure('duration_ms','integer_0_5000');
  switch (args.action) {
    case 'key':
      try { return { key: browserKey(args.key, privateInput) }; }
      catch (error) { if (error.message === 'INVALID_REQUEST') throw argumentFailure('key', 'key_chord'); throw error; }
    case 'fill': case 'type': case 'replace_selection': case 'select_text':
      if(args.action==='select_text'&&(!args.text||['prefix','suffix'].some(k=>args[k]!==undefined&&(typeof args[k]!=='string'||args[k].length>20000))||args.selection_type!==undefined&&!['text','cursor_before','cursor_after'].includes(args.selection_type)))throw argumentFailure('arguments','documented_fields');
      if (typeof args.text !== 'string' || args.text.length > 20000) throw argumentFailure('text', 'text_max_20000');
      break;
    case 'pointer_click': case 'double_click': case 'hover':
      if (!args.selector) point('x','y');
      break;
    case 'scroll':
      finite('delta_y');
      if (args.delta_x !== undefined) finite('delta_x');
      if (args.x !== undefined || args.y !== undefined) point('x','y');
      break;
    case 'drag':
      point('from_x','from_y'); point('to_x','to_y');
      if (args.duration_ms !== undefined && (!Number.isInteger(args.duration_ms) || args.duration_ms < 0 || args.duration_ms > 5000)) throw argumentFailure('duration_ms', 'integer_0_5000');
      break;
    case 'wait':
      if (args.state !== undefined && !['visible','hidden','enabled','text','value'].includes(args.state)) throw argumentFailure('state', 'documented_condition');
      if (['text','value'].includes(args.state) ? typeof args.equals!=='string'||args.equals.length>2000 : args.equals!==undefined) throw argumentFailure('equals','condition_text_max_2000');
      if (args.timeout_ms !== undefined && (!Number.isInteger(args.timeout_ms) || args.timeout_ms < 0 || args.timeout_ms > 30000)) throw argumentFailure('timeout_ms', 'integer_0_30000');
      break;
    case 'query': case 'table':
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit<1 || args.limit>200)) throw argumentFailure('limit','integer_1_200');
      if (args.cursor !== undefined && (typeof args.cursor!=='string' || args.cursor.length>100)) throw argumentFailure('cursor','current_cursor');
      break;
    case 'attribute':
      if (!['href','title','aria-label','aria-checked','aria-selected','aria-expanded','aria-rowcount','aria-colcount'].includes(args.attribute)) throw argumentFailure('attribute','readable_attribute');
      break;
    case 'source':
      if(args.source!==undefined&&!['ax','dom'].includes(args.source))throw argumentFailure('arguments','documented_fields');
      if(args.field!==undefined&&(typeof args.field!=='string'||args.field.length>2000))throw argumentFailure('arguments','documented_fields');
      if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>12000))throw argumentFailure('limit','documented_fields');
      if(args.cursor!==undefined&&(typeof args.cursor!=='string'||args.cursor.length>100))throw argumentFailure('cursor','current_cursor');
      break;
    case 'select_range':
      if(args.direction!==undefined&&!['forward','backward','none'].includes(args.direction))throw argumentFailure('arguments','documented_fields');
      if(!Number.isSafeInteger(args.start)||!Number.isSafeInteger(args.end)||args.start<0||args.end<args.start)throw argumentFailure('arguments','documented_fields');
      break;
    case 'clipboard':
      if(!['read','write','types'].includes(args.operation))throw argumentFailure('arguments','documented_fields');
      if(args.operation==='write'&&Buffer.byteLength(JSON.stringify(args.items??[]))>90000)throw argumentFailure('arguments','documented_fields');
      if(args.operation==='write'&&(!Array.isArray(args.items)||args.items.length>16||args.items.some(item=>!item||typeof item!=='object'||Object.entries(item).some(([type,value])=>!['text/plain','text/html','image/png'].includes(type)||typeof value!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)||value.length>90000))))throw argumentFailure('arguments','documented_fields');
      break;
    case 'input_sequence': {
      if(!Array.isArray(args.events)||!args.events.length||args.events.length>100)throw argumentFailure('arguments','documented_fields');
      let waitTotal=0; const held=new Set();
      for(const event of args.events){
        const allowed=event?.type==='wait'?['type','duration_ms']:['keyDown','keyUp'].includes(event?.type)?['type','key','modifiers','repeat']:['type','x','y','button','buttons','modifiers','click_count'];
        if(!event||Object.keys(event).some(k=>!allowed.includes(k)))throw argumentFailure('arguments','documented_fields');
        if(event.modifiers!==undefined&&(!Array.isArray(event.modifiers)||event.modifiers.some(k=>!['Alt','Control','Meta','Shift'].includes(k))))throw argumentFailure('arguments','documented_fields');
        if(event.repeat!==undefined&&typeof event.repeat!=='boolean'||event.click_count!==undefined&&(!Number.isInteger(event.click_count)||event.click_count<1||event.click_count>3))throw argumentFailure('arguments','documented_fields');
        if(event.buttons!==undefined&&(!Number.isInteger(event.buttons)||event.buttons<0||event.buttons>7))throw argumentFailure('arguments','documented_fields');
        if(['keyDown','keyUp'].includes(event.type)){
          const key=browserKey(event.key,privateInput);
          if(['Alt','Control','Meta','Shift'].includes(key.key)){if(event.type==='keyDown')held.add(key.key);else held.delete(key.key);}
          const modifiers=new Set([...held,...event.modifiers??[]]);
          browserKey([...modifiers,key.key].join('+'),privateInput);
        }
        else if(event.type==='wait'){if(!Number.isInteger(event.duration_ms)||event.duration_ms<0||event.duration_ms>5000||(waitTotal+=event.duration_ms)>30000)throw argumentFailure('duration_ms','integer_0_5000');}
        else if(['mouseMoved','mousePressed','mouseReleased'].includes(event.type)){if(!Number.isFinite(event.x)||!Number.isFinite(event.y)||event.x<0||event.y<0||event.button!==undefined&&!['left','right','middle'].includes(event.button))throw argumentFailure('coordinates','nonnegative_coordinates');}
        else throw argumentFailure('arguments','documented_fields');
      }
      break;
    }
    case 'set_files':
      if(!args.selector||!Array.isArray(args.files)||!args.files.length||args.files.length>16||Buffer.byteLength(JSON.stringify(args.files))>262144)throw argumentFailure('arguments','documented_fields');
      for(const file of args.files)if(!file||Object.keys(file).some(k=>!['name','mime_type','base64'].includes(k))||typeof file.name!=='string'||!file.name||file.name.length>255||[...file.name].some(c=>c==='/'||c.charCodeAt(0)===92||c.charCodeAt(0)===0)||typeof file.mime_type!=='string'||file.mime_type.length>200||typeof file.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(file.base64))throw argumentFailure('arguments','documented_fields');
      break;
    case 'set_value': case 'perform_action':
      if(!args.selector)throw argumentFailure('selector','documented_selector');break;
    case 'paste':
      for(const key of ['text','html'])if(args[key]!==undefined&&(typeof args[key]!=='string'||Buffer.byteLength(args[key])>65536))throw argumentFailure('text','text_max_20000');
      break;
    case 'capabilities': case 'selection': case 'select_all': case 'copy': case 'cut':
    case 'click': case 'read': case 'text': break;
    default: throw argumentFailure('action', 'supported_action');
  }
  return {};
}
