// The environment owner supplies an authorized response over the product port.
// Blob downloads stay local to this trusted document.
const limit = 256 * 1024 * 1024;
let retained = 0;
let active = 0;

export async function saveBrowserDownload(response: Response, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (active >= 4) throw new Error('Browser download limit');
  active++;
  let size = 0;
  let released = false;
  const release = () => { if (!released) { released = true; retained -= size; } };
  try {
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Browser download unavailable'); }
    const header = response.headers.get('Content-Length');
    const expected = header === null ? undefined : Number(header);
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || expected > limit)) {
      await response.body.cancel(); throw new Error('Browser download limit');
    }
    // Runtime emits mime.FormatMediaType attachment headers. These standard
    // response headers survive the shared Flowersec proxy's header policy.
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const encoded = /(?:^|;)\s*filename\*=utf-8''([^;]+)/iu.exec(disposition)?.[1];
    const plain = /(?:^|;)\s*filename=(?:"((?:[^"\\]|\\.)*)"|([^;]+))/iu.exec(disposition);
    let name = 'download';
    try { name = encoded ? decodeURIComponent(encoded) : (plain?.[1] ?? plain?.[2] ?? name).replace(/\\(.)/gu, '$1'); }
    catch { await response.body.cancel(); throw new Error('Browser download unavailable'); }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        if (retained + chunk.value.byteLength > limit) throw new Error('Browser download limit');
        size += chunk.value.byteLength; retained += chunk.value.byteLength;
        chunks.push(new Uint8Array(chunk.value));
      }
      signal.throwIfAborted();
      if (expected !== undefined && size !== expected) throw new Error('Browser download incomplete');
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const object = URL.createObjectURL(new Blob(chunks, { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = object;
    link.download = Array.from(name, character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === '/' || character === '\\' ? '_' : character).join('');
    link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    // Keep the local object alive while the native download consumes it. The
    // same budget includes these objects, not just simultaneous HTTP readers.
    setTimeout(() => { URL.revokeObjectURL(object); release(); }, 60000);
  } catch (error) { release(); throw error; }
  finally { active--; }
}
