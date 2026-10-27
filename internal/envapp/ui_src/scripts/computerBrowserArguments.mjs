import { browserKey } from './computerBrowserKeys.mjs';

// This vocabulary contains product-authored diagnostics only, never page text.
export const argumentFailure = (field, expected) => Object.assign(new Error('INVALID_REQUEST'), {
  diagnostic: { phase: 'validation', field, expected, recovery: 'correct_arguments' },
});
export function validateBrowserAction(args, privateInput = false) {
  const fields = {
    key: ['key', 'selector'], fill: ['text', 'selector'], type: ['text'],
    click: ['selector'], pointer_click: ['x', 'y'], double_click: ['x', 'y'],
    scroll: ['selector', 'x', 'y', 'delta_x', 'delta_y'],
    drag: ['from_x', 'from_y', 'to_x', 'to_y', 'duration_ms'],
    wait: ['selector', 'state', 'equals', 'timeout_ms'], query: ['selector', 'limit', 'cursor'], table: ['selector', 'limit', 'cursor'],
    attribute: ['selector', 'attribute'], read: ['selector'],
  };
  const allowed = fields[args.action];
  if (!allowed) throw argumentFailure('action', 'supported_action');
  const image = ['coordinate_space', 'frame', 'document_id'];
  if (Object.keys(args).some(key => !['action', 'target', 'description', ...allowed, ...image].includes(key))) throw argumentFailure('arguments', 'documented_fields');
  if (image.some(key => args[key] !== undefined) && (!['pointer_click', 'double_click', 'scroll', 'drag'].includes(args.action) || args.selector || args.coordinate_space !== 'image_pixels' || typeof args.frame !== 'string' || typeof args.document_id !== 'string')) throw argumentFailure('coordinate_space', 'image_pixels_with_frame');
  if (['click', 'fill', 'read', 'query', 'table', 'attribute', 'wait'].includes(args.action) && !args.selector) throw argumentFailure('selector', 'documented_selector');
  if (args.selector !== undefined) {
    const s = args.selector;
    if (!s || Array.isArray(s) || typeof s !== 'object' || Object.keys(s).some(key => !['ref', 'role', 'roles', 'name', 'exact', 'root_ref'].includes(key)) ||
      (s.ref !== undefined && (typeof s.ref !== 'string' || !s.ref)) ||
      (s.ref === undefined && !(typeof s.role === 'string' && s.role || Array.isArray(s.roles) && s.roles.length && s.roles.every(role => typeof role === 'string' && role))) ||
      (s.name !== undefined && typeof s.name !== 'string') || (s.root_ref !== undefined && typeof s.root_ref !== 'string') || (s.exact !== undefined && typeof s.exact !== 'boolean')) throw argumentFailure('selector', 'documented_selector');
  }
  const finite = key => { if (!Number.isFinite(args[key])) throw argumentFailure(key, 'finite_number'); };
  const point = (x,y) => { finite(x); finite(y); if (args[x] < 0 || args[y] < 0) throw argumentFailure('coordinates', 'nonnegative_coordinates'); };
  switch (args.action) {
    case 'key':
      try { return { key: browserKey(args.key, privateInput) }; }
      catch (error) { if (error.message === 'INVALID_REQUEST') throw argumentFailure('key', 'key_chord'); throw error; }
    case 'fill': case 'type':
      if (typeof args.text !== 'string' || args.text.length > 20000) throw argumentFailure('text', 'text_max_20000');
      break;
    case 'pointer_click': case 'double_click':
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
    case 'click': case 'read': break;
    default: throw argumentFailure('action', 'supported_action');
  }
  return {};
}
