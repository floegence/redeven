export type TessivenOpenRequest = {
  canvasID: string;
  version?: number;
  nonce: number;
};

// Only the canonical local product path is eligible. External URLs are never
// interpreted as instructions to open a local canvas, even with the same path.
export function parseTessivenLink(
  href: string,
  base: string,
): TessivenOpenRequest | null {
  try {
    const origin = new URL(base);
    const url = new URL(href, origin);
    if (
      url.origin !== origin.origin ||
      url.pathname !== '/_redeven_proxy/env/' ||
      url.hash
    )
      return null;
    if (
      [...url.searchParams.keys()].some(
        (key) =>
          !['surface', 'canvas', 'version'].includes(key) ||
          url.searchParams.getAll(key).length !== 1,
      )
    )
      return null;
    const id = url.searchParams.get('canvas');
    const version = url.searchParams.get('version');
    if (
      url.searchParams.get('surface') !== 'tessiven' ||
      !id ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)
    )
      return null;
    if (
      version !== null &&
      (!/^[1-9][0-9]*$/.test(version) || !Number.isSafeInteger(Number(version)))
    )
      return null;
    return {
      canvasID: id,
      ...(version ? { version: Number(version) } : {}),
      nonce: Date.now(),
    };
  } catch {
    return null;
  }
}

export function handleTessivenLink(
  event: MouseEvent,
  open: (request: TessivenOpenRequest) => void,
): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return false;
  const link =
    event.target instanceof Element ? event.target.closest('a[href]') : null;
  const request = link
    ? parseTessivenLink(link.getAttribute('href') ?? '', window.location.href)
    : null;
  if (!request) return false;
  event.preventDefault();
  event.stopPropagation();
  open(request);
  return true;
}
