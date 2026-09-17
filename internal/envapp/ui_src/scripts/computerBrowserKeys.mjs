// The public key grammar retains the named keys and modifier chords accepted by
// the coordinate tools. This table is product code, not a Playwright internal API.
const named = {
  Backspace: [8, 'Backspace'], Tab: [9, 'Tab', '\t'], Enter: [13, 'Enter', '\r'],
  Shift: [16, 'ShiftLeft'], Control: [17, 'ControlLeft'], Alt: [18, 'AltLeft'],
  Pause: [19, 'Pause'], CapsLock: [20, 'CapsLock'], Escape: [27, 'Escape'],
  ' ': [32, 'Space', ' '], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'],
  End: [35, 'End'], Home: [36, 'Home'], ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'],
  ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'], Insert: [45, 'Insert'], Delete: [46, 'Delete'],
  Meta: [91, 'MetaLeft'], ContextMenu: [93, 'ContextMenu'], NumLock: [144, 'NumLock'], ScrollLock: [145, 'ScrollLock'],
};
for (let index = 1; index <= 24; index++) named[`F${index}`] = [111 + index, `F${index}`];
const aliases = { ctrl: 'Control', cmd: 'Meta', command: 'Meta', option: 'Alt', esc: 'Escape', return: 'Enter', del: 'Delete', space: ' ', spacebar: ' ', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
const normalize = value => aliases[value.toLowerCase()] || Object.keys(named).find(key => key.toLowerCase() === value.toLowerCase()) || value;
const punctuation = { ';': [186, 'Semicolon'], '=': [187, 'Equal'], ',': [188, 'Comma'], '-': [189, 'Minus'], '.': [190, 'Period'], '/': [191, 'Slash'], '`': [192, 'Backquote'], '[': [219, 'BracketLeft'], '\\': [220, 'Backslash'], ']': [221, 'BracketRight'], "'": [222, 'Quote'] };
const shifted = '~!@#$%^&*()_+{}|:"<>?';
const unshifted = '`1234567890-=[]\\;\',./';

export function browserKey(value, privateInput = false) {
  if (typeof value !== 'string' || !value || value.length > 80) throw new Error('INVALID_REQUEST');
  const parts = value.split('+');
  let raw = parts.pop();
  if (raw === '' && parts.at(-1) === '') { parts.pop(); raw = '+'; }
  let key = normalize(raw), modifiers = 0;
  for (const part of parts) {
    const modifier = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }[normalize(part)];
    if (!modifier) throw new Error('INVALID_REQUEST');
    modifiers |= modifier;
  }
  if (!privateInput && (modifiers & 6) && ['c', 'x', 'v'].includes(key.toLowerCase())) throw new Error('TARGET_NOT_ALLOWED');
  let definition = named[key];
  if (!definition && key.length === 1) {
    if (modifiers & 8) {
      if (/[a-z]/u.test(key)) key = key.toUpperCase();
      else if (unshifted.includes(key)) key = shifted[unshifted.indexOf(key)];
    }
    const base = shifted.includes(key) ? unshifted[shifted.indexOf(key)] : key;
    if (/^[a-z]$/iu.test(base)) definition = [base.toUpperCase().charCodeAt(0), `Key${base.toUpperCase()}`, key];
    else if (/^[0-9]$/u.test(base)) definition = [base.charCodeAt(0), `Digit${base}`, key];
    else if (punctuation[base]) definition = [...punctuation[base], key];
  }
  if (!definition) throw new Error('INVALID_REQUEST');
  const [windowsVirtualKeyCode, code, text] = definition;
  return { key, code, windowsVirtualKeyCode, modifiers, ...(text && !(modifiers & 7) ? { text } : {}) };
}
