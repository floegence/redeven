import type { Rectangle, WebContents } from 'electron';

/** Captures the authorized WebContents only; navigation invalidates the result. */
export async function captureAuthorizedPage(source: WebContents, input: {
  url: string;
  region?: Rectangle;
  valid: () => boolean;
}): Promise<{ png: Uint8Array }> {
  let navigated = false;
  const invalidate = () => { navigated = true; };
  const check = () => {
    if (navigated || source.isDestroyed() || source.getURL() !== input.url || !input.valid()) throw new Error('Screenshot source changed.');
  };
  check();
  source.on('did-start-navigation', invalidate);
  try {
    // Only inspect visible privacy markers in this authorized top document.
    const privatePage = await source.executeJavaScript(`Array.from(document.querySelectorAll('input[type="password"], [data-private="true"], [data-flower-capture-private]')).some(element => element.getClientRects().length > 0)`);
    check();
    if (privatePage) throw new Error('Screenshot source is private.');
    const image = await source.capturePage(input.region, { stayHidden: true });
    check();
    if (image.isEmpty()) throw new Error('Screenshot is unavailable.');
    const png = image.toPNG();
    if (png.length > 32 * 1024 * 1024) throw new Error('Screenshot is too large.');
    return { png: new Uint8Array(png) };
  } finally {
    source.removeListener('did-start-navigation', invalidate);
  }
}
