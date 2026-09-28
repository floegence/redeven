// Canvas rendering and controller ownership are shared. Platform adapters own
// wire encoding, native coordinates and platform-specific menus/video options.
function createHostApplicationCanvas() {
  const canvas = document.createElement('canvas');
  canvas.id = 'application';
  canvas.className = 'mac-app-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', document.title);
  canvas.setAttribute('data-floe-remote-pointer', '');
  document.getElementById('application').replaceWith(canvas);
  document.body.classList.add('mac-app-viewer');
  return canvas;
}

function createHostApplicationFramePlayer({canvas, decode, isValid, onResize, onPaint, onError}) {
  const context = canvas.getContext('2d', {alpha:false});
  let generation = 0, pending, drawing;
  async function draw() {
    if (drawing) return;
    const job = {generation};
    drawing = job;
    let next;
    try {
      while (pending && drawing === job) {
        next = pending; pending = null;
        const image = await decode(next);
        try {
          if (job.generation !== generation || !isValid(next)) continue;
          const width = image.displayWidth || image.width, height = image.displayHeight || image.height;
          if (canvas.width !== width || canvas.height !== height) {
            onResize(); canvas.width = width; canvas.height = height;
          }
          context.drawImage(image, 0, 0);
          onPaint(next, width, height);
        } finally { image.close(); }
      }
    } catch (error) {
      if (job.generation === generation && isValid(next)) onError(next, error);
    } finally {
      if (drawing === job) { drawing = null; if (pending) void draw(); }
    }
  }
  return {
    receive(packet) { pending = packet; void draw(); },
    invalidate() { generation++; pending = null; drawing = null; },
  };
}

function hostApplicationCanvasPoint(canvas, position) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const width = canvas.width * scale, height = canvas.height * scale;
  return {
    x: Math.max(0, Math.min(1, (position.clientX - rect.left - (rect.width - width) / 2) / width)),
    y: Math.max(0, Math.min(1, (position.clientY - rect.top - (rect.height - height) / 2) / height)),
    modifiers: ['Meta', 'Control', 'Alt', 'Shift'].filter((_, i) => [position.metaKey, position.ctrlKey, position.altKey, position.shiftKey][i]),
  };
}

function createHostApplicationCanvasInput(options) {
  let keyboardVisible = false;
  const input = hostApplicationInput.createRemoteInput({
    surface: options.canvas, label: config.copy.input,
    commitText(text, target) { pointer.flush(); if (options.isValid(target)) options.commitText(text, target); },
    sendKey(key, target) { pointer.flush(); if (options.isValid(target)) options.sendKey(key, target); },
    release: options.releaseInput,
    clipboard(event, target) { pointer.flush(); return options.clipboard?.(event, target) || false; },
    onKeyboardVisibilityChange(visible) { keyboardVisible = visible; options.onKeyboardVisibilityChange(visible); },
  });
  hostApplicationAppearance.copy(input.element, 'input', 'aria-label');
  const feedback = createHostApplicationHoldFeedback(document);
  const pointer = hostApplicationPointer.createRemotePointer({
    surface: options.canvas,
    resolveTarget: () => options.isValid(options.target()) ? options.target() : null,
    isTargetValid: options.isValid,
    sendPointer: options.sendPointer,
    release: options.releasePointer,
    onActivate(position) {
      options.activate(); input.setAnchor(position.clientX, position.clientY);
      if (position.pointerType !== 'touch' || keyboardVisible) input.focus();
    },
    onHoldChange: feedback.update,
  });
  return {input, pointer, get keyboardVisible() {return keyboardVisible;},
    dispose() {pointer.dispose(); feedback.dispose(); input.dispose();}};
}
