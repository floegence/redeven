// Injected into the measured page; no product state is changed by collection.
export function collectDrag() {
  window.__flowerLongThreadDrag?.stop?.();
  const state = { started: performance.now(), events: [], commits: [], frames: [], queues: [], tasks: [], outputs: [], interruptions: [], active: true };
  let latest, dragRoot, lastFrame, raf;
  const focus = document.activeElement;
  // A titlebar drag intentionally focuses its own window; later streaming
  // must retain that owner. Text selection and drafts remain independently pinned.
  dragRoot = focus instanceof Element ? focus.closest('[data-floe-geometry-surface="floating-window"]') : undefined;
  const draft = document.querySelector('[aria-label="Preview draft"]');
  const selection = [draft.selectionStart, draft.selectionEnd];
  const handler = event => {
    if (event.type === 'pointerdown') dragRoot = event.target instanceof Element ? event.target.closest('[data-floe-geometry-surface="floating-window"]') : undefined;
    if (event.type === 'pointermove' && !(event.buttons & 1)) {
      state.interruptions.push({ type: 'buttons_released', at: performance.now() });
      return;
    }
    if (!dragRoot) return;
    latest = { id: state.events.length, type: event.type, at: performance.now(), source: event.timeStamp, x: event.clientX, y: event.clientY, trusted: event.isTrusted };
    state.events.push(latest);
    if (event.type === 'pointerup') dragRoot = undefined;
  };
  const eventTypes = ['pointerdown', 'pointermove', 'pointerup'];
  for (const type of eventTypes) document.addEventListener(type, handler, true);
  const interrupted = event => state.interruptions.push({ type: event.type, at: performance.now() });
  const hidden = () => { if (document.hidden) interrupted({ type: 'document_hidden' }); };
  window.addEventListener('blur', interrupted);
  document.addEventListener('pointercancel', interrupted, true);
  document.addEventListener('visibilitychange', hidden);
  const observed = new Set(), lengths = new WeakMap();
  const outputs = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.type === 'characterData' ? [record.target] : record.addedNodes) {
        const texts = node instanceof Text ? [node] : [];
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) texts.push(walker.currentNode);
        for (const text of texts) {
          if (!text.parentElement?.closest('.flower-chat-md-block')) continue;
          const start = Math.max(0, (lengths.get(text) ?? 0) - 12);
          lengths.set(text, text.length);
          for (const match of text.substringData(start, text.length - start).matchAll(/word(\d{6})/g)) {
            const index = Number(match[1]);
            if (!observed.has(index)) { observed.add(index); state.outputs.push({ index, at: Date.now() }); }
          }
        }
      }
    }
  });
  outputs.observe(document.body, { subtree: true, characterData: true, childList: true });
  const transforms = new WeakMap();
  const mutations = new MutationObserver(records => {
    for (const record of records) {
      const element = record.target;
      if (!(element instanceof HTMLElement) || element !== dragRoot || latest?.type !== 'pointermove') continue;
      const value = element.style.transform;
      if (transforms.get(element) === value) continue;
      transforms.set(element, value);
      state.commits.push({ at: performance.now(), event: latest.id, source: latest.source, delay: performance.now() - latest.source, style: value });
    }
  });
  mutations.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
  const marks = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) if (entry.name === 'flower.live.frame_queue') state.queues.push({ at: entry.startTime, ...entry.detail });
  });
  marks.observe({ type: 'mark' });
  const tasks = new PerformanceObserver(list => state.tasks.push(...list.getEntries().map(entry => ({ at: entry.startTime, duration: entry.duration }))));
  tasks.observe({ type: 'longtask' });
  const frame = timestamp => {
    if (!state.active) return;
    state.frames.push({ at: timestamp, delta: lastFrame ? timestamp - lastFrame : 0 });
    lastFrame = timestamp;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const stop = () => {
    state.active = false;
    cancelAnimationFrame(raf);
    mutations.disconnect(); outputs.disconnect(); marks.disconnect(); tasks.disconnect();
    for (const type of eventTypes) document.removeEventListener(type, handler, true);
    window.removeEventListener('blur', interrupted);
    document.removeEventListener('pointercancel', interrupted, true);
    document.removeEventListener('visibilitychange', hidden);
    return { ...state, focusPreserved: focus === document.activeElement, selectionPreserved: selection[0] === draft.selectionStart && selection[1] === draft.selectionEnd };
  };
  window.__flowerLongThreadDrag = { state, stop };
}
