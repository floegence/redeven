import type { OnBeforeSendHeadersListenerDetails, Session } from 'electron';
import {
  CODESPACE_NATIVE_AUTH_HEADER,
  type NativeCodeSpaceGateway,
} from './codespaceNativeGateway';

function sameOrigin(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function nativeCodeSpaceRequestIsOwned(
  details: Pick<
    OnBeforeSendHeadersListenerDetails,
    | 'url'
    | 'frame'
    | 'referrer'
    | 'resourceType'
    | 'webContentsId'
    | 'requestHeaders'
  >,
  origin: string,
  ownerID: number,
): boolean {
  if (!sameOrigin(details.url, origin)) return false;
  if (
    details.webContentsId !== undefined &&
    details.webContentsId !== -1 &&
    details.webContentsId !== ownerID
  )
    return false;
  let frame = details.frame;
  const site = Object.entries(details.requestHeaders).find(
    ([name]) => name.toLowerCase() === 'sec-fetch-site',
  )?.[1];
  if (
    details.resourceType === 'mainFrame' &&
    details.webContentsId === ownerID &&
    (site === 'none' || site === 'same-origin')
  )
    return true;
  if (frame) {
    let owned = false;
    while (frame) {
      if (sameOrigin(frame.url, origin)) owned = true;
      else if (
        frame.url !== '' &&
        frame.url !== 'about:blank' &&
        frame.url !== 'about:srcdoc' &&
        !frame.url.startsWith(`blob:${origin}/`)
      )
        return false;
      frame = frame.parent;
    }
    return owned;
  }
  // Chromium owns these request provenance fields even when a Worker/SW has no frame.
  const initiator = Object.entries(details.requestHeaders).find(
    ([name]) => name.toLowerCase() === 'origin',
  )?.[1];
  return (
    site === 'same-origin' ||
    sameOrigin(details.referrer, origin) ||
    (details.resourceType === 'webSocket' &&
      typeof initiator === 'string' &&
      sameOrigin(initiator, origin))
  );
}

/** The isolated partition has exactly one owner for request authentication. */
export function installNativeCodeSpaceSession(
  session: Session,
  gateway: NativeCodeSpaceGateway,
  ownerID: number,
): () => void {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers))
      if (name.toLowerCase() === CODESPACE_NATIVE_AUTH_HEADER.toLowerCase())
        delete headers[name];
    if (sameOrigin(details.url, gateway.origin)) {
      if (!nativeCodeSpaceRequestIsOwned(details, gateway.origin, ownerID)) {
        callback({ cancel: true });
        return;
      }
      headers[CODESPACE_NATIVE_AUTH_HEADER] = gateway.token;
    }
    callback({ requestHeaders: headers });
  });
  return () => {
    session.webRequest.onBeforeSendHeaders(null);
  };
}
