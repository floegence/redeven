/* global window, document */

// Installed read-only on the existing Desktop workspace stream. It starts no
// transport and does not replace product adapters. Stop before private input.
export function observeDesktopComputerFrames() {
  const frames = [];
  const decoded = [];
  const visibility = [{ at: Date.now(), state: document.visibilityState }];
  const streams = new Map();
  const pending = new Set();
  let stopped = false;
  const receive = (event) => {
    if (stopped || event.kind !== 'chunk') return;
    let stream = streams.get(event.stream_id);
    if (!stream) { stream = { decoder: new TextDecoder(), buffer: '' }; streams.set(event.stream_id, stream); }
    stream.buffer += stream.decoder.decode(event.chunk, { stream: true });
    const lines = stream.buffer.split('\n');
    stream.buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let envelope;
      try { envelope = JSON.parse(line.slice(5)); } catch { continue; }
      if (envelope.kind !== 'computer.frame' || frames.length >= 2000) continue;
      const frame = envelope.computer_frame;
      frames.push({ target: frame.target_id, thread: envelope.thread_id, sequence: frame.sequence, sha256: frame.sha256, at: Date.now() });
    }
  };
  // Browser qualification feeds CDP's passive copy of the existing HTTP
  // stream here. Neither path creates or replaces the product transport.
  window.__recordComputerStreamChunk = receive;
  const unsubscribe = window.redevenDesktopSettings?.subscribeRuntimeFlowerStream(receive) ?? (() => undefined);
  const load = (event) => {
    const image = event.target;
    if (stopped || !image.matches?.('.flower-computer-stage-frame') || !image.complete || image.naturalWidth === 0 || !image.src.startsWith('blob:')) return;
    const sample = { target: image.closest('.flower-computer-stage')?.dataset.computerTarget,
      thread: document.querySelector('.flower-surface')?.getAttribute('data-flower-selected-thread-id'),
      width: image.naturalWidth, height: image.naturalHeight, at: Date.now() };
    const work = fetch(image.src).then((response) => response.arrayBuffer())
      .then((bytes) => crypto.subtle.digest('SHA-256', bytes))
      .then((digest) => { if (decoded.length < 2000) decoded.push({ ...sample, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') }); })
      .catch(() => undefined).finally(() => pending.delete(work));
    pending.add(work);
  };
  const changed = () => visibility.push({ at: Date.now(), state: document.visibilityState });
  document.addEventListener('load', load, true);
  document.addEventListener('visibilitychange', changed);
  window.__stopComputerLiveEvidence = async () => {
    stopped = true;
    unsubscribe();
    document.removeEventListener('load', load, true);
    document.removeEventListener('visibilitychange', changed);
    await Promise.allSettled([...pending]);
    delete window.__stopComputerLiveEvidence;
    delete window.__recordComputerStreamChunk;
    return { frames, decoded, visibility, streamCount: streams.size };
  };
}

export function decodedLiveFramesForTarget(evidence, target) {
  const used = new Set();
  return evidence.frames.filter((frame) => {
    if (frame.target !== target) return false;
    const index = evidence.decoded.findIndex((image, index) => !used.has(index) &&
      image.target === frame.target && image.thread === frame.thread && image.sha256 === frame.sha256 &&
      image.at >= frame.at && image.at - frame.at <= 2000);
    if (index < 0) return false;
    used.add(index);
    return true;
  });
}
