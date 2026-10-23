const duration = 320;
const maxGroups = 32;
const phases = 20;
const maxText = 8192;
const excluded = 'a, code, pre, button, svg, math, [data-floe-markdown-media], .flower-chat-source-list';

/** Paint live additions without splitting text, delaying content or changing layout. */
export function createStreamingTextReveal(root: HTMLElement) {
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce), (forced-colors: active)');
  const supported = typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!CSS.highlights;
  const groups = new Map<number, { ranges: Range[]; born: number; phase: number }>();
  let frame = 0;
  let initialized = false;
  let enabled = false;
  const name = (phase: number) => 'flower-stream-' + phase;
  const detach = (phase: number, ranges: Range[]) => {
    const highlight = CSS.highlights.get(name(phase));
    if (!highlight) return;
    for (const range of ranges) highlight.delete(range);
    if (!highlight.size) CSS.highlights.delete(name(phase));
  };
  const attach = (phase: number, ranges: Range[]) => {
    const highlight = CSS.highlights.get(name(phase)) ?? new Highlight();
    for (const range of ranges) highlight.add(range);
    CSS.highlights.set(name(phase), highlight);
  };
  const remove = (slot: number) => {
    const group = groups.get(slot)!;
    detach(group.phase, group.ranges); groups.delete(slot);
  };
  const clear = () => {
    cancelAnimationFrame(frame); frame = 0;
    for (const slot of groups.keys()) remove(slot);
    preference?.removeEventListener('change', preferenceChanged);
    document.removeEventListener('visibilitychange', preferenceChanged);
  };
  const allowed = () => supported && !preference?.matches && !document.hidden;
  const tick = (now: number) => {
    frame = 0;
    if (!allowed() || !root.isConnected) { clear(); return; }
    for (const [slot, group] of groups) {
      // A callback's frame timestamp can precede additions in that same frame.
      const phase = Math.max(0, Math.floor((now - group.born) / duration * phases));
      if (phase >= phases || group.ranges.some(range => !root.contains(range.startContainer) || !root.contains(range.endContainer))) { remove(slot); continue; }
      if (phase !== group.phase) {
        detach(group.phase, group.ranges); attach(phase, group.ranges); group.phase = phase;
      }
    }
    if (groups.size) frame = requestAnimationFrame(tick);
    else clear();
  };
  const add = (ranges: Range[]) => {
    if (!enabled || !allowed() || !ranges.length) return;
    // A burst is already in the DOM; older paint effects may settle early.
    // Neither provider delivery nor canonical completion waits for animation.
    if (groups.size === maxGroups) remove(groups.keys().next().value!);
    if (!groups.size) {
      preference?.addEventListener('change', preferenceChanged);
      document.addEventListener('visibilitychange', preferenceChanged);
    }
    let slot = 0; while (groups.has(slot)) slot++;
    groups.set(slot, { ranges, born: performance.now(), phase: 0 });
    attach(0, ranges);
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const textNodes = (element: HTMLElement): Text[] | undefined => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = []; let length = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.parentElement?.closest(excluded)) continue;
      length += node.length;
      if (length > maxText || nodes.length === 128) return undefined;
      nodes.push(node);
    }
    return nodes;
  };
  const read = (elements: readonly HTMLElement[]) => {
    if (!enabled) return undefined;
    let text = '';
    for (const element of elements) {
      const nodes = textNodes(element);
      if (!nodes) return undefined;
      text += nodes.map(node => node.data).join('');
      if (text.length > maxText) return undefined;
    }
    return text;
  };
  const preferenceChanged = () => { if (!allowed()) clear(); };
  return {
    begin(streaming: boolean, reset: boolean) {
      enabled = initialized && streaming && !reset && allowed();
      initialized = true;
      if (reset || !allowed()) clear();
      return enabled;
    },
    read,
    reveal(elements: readonly HTMLElement[], previous: string | undefined) {
      if (!enabled || previous === undefined) return;
      const text = read(elements);
      // Renderer separators after the old last list item are not authored
      // content; a new item is inserted before that trailing whitespace.
      const prefix = previous.trimEnd();
      if (text === undefined || !text.startsWith(prefix) || text.trimEnd() === prefix) return;
      let skip = prefix.length;
      const ranges: Range[] = [];
      for (const element of elements) for (const node of textNodes(element)!) {
        if (skip >= node.length) { skip -= node.length; continue; }
        const range = document.createRange();
        range.setStart(node, skip); range.setEnd(node, node.length); ranges.push(range); skip = 0;
      }
      add(ranges.slice(-128));
    },
    append(element: HTMLElement, length: number, append: () => void) {
      if (!enabled || length > maxText) { append(); return; }
      let tail: Node | null = element;
      while (tail?.lastChild) tail = tail.lastChild;
      const range = document.createRange();
      if (tail instanceof Text) range.setStart(tail, tail.length);
      else range.setStart(element, element.childNodes.length);
      append();
      let end: Node | null = element;
      while (end?.lastChild) end = end.lastChild;
      if (end instanceof Text) range.setEnd(end, end.length);
      else range.setEnd(element, element.childNodes.length);
      if (!range.collapsed && !element.closest(excluded)) add([range]);
    },
    dispose: clear,
  };
}
