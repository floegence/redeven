export type WebServiceBrowserCopy = Readonly<{
  locale: string;
  title: string;
  addressLabel: string;
  addressPlaceholder: string;
  backLabel: string;
  forwardLabel: string;
  reloadLabel: string;
  stopLabel: string;
  navigateLabel: string;
  developerToolsLabel: string;
  openExternalLabel: string;
  secureRouteLabel: string;
}>;

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildWebServiceBrowserDocumentURL(copy: WebServiceBrowserCopy): string {
  const document = `<!doctype html>
<html lang="${htmlEscape(copy.locale)}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(copy.title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: light-dark(#f4f5f7, #1b1d22); color: light-dark(#202124, #eef0f3); }
    .browser-bar { height: 54px; display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid light-dark(#d9dce1, #34373e); background: light-dark(#f4f5f7, #202228); }
    .nav-button { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: default; }
    .nav-button:not(:disabled):hover { background: light-dark(#e3e5e9, #30333a); cursor: pointer; }
    .nav-button[aria-pressed="true"] { background: light-dark(#dce8f7, #263a52); color: light-dark(#1f5f9f, #8fbae8); }
    .nav-button:focus-visible, .address-input:focus-visible, .go-button:focus-visible { outline: 2px solid #2f75d6; outline-offset: 1px; }
    .nav-button:disabled { opacity: .34; }
    .nav-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .nav-button svg[hidden] { display: none; }
    .address-wrap { min-width: 0; height: 38px; flex: 1 1 auto; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 12px; border: 1px solid light-dark(#cfd3da, #3c4048); border-radius: 7px; background: light-dark(#fff, #16181d); box-shadow: 0 1px 2px rgb(0 0 0 / 7%); }
    .route-mark { width: 16px; height: 16px; flex: 0 0 16px; color: light-dark(#4b5563, #aeb6c3); }
    .route-mark svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .address-input { min-width: 0; height: 100%; flex: 1 1 auto; padding: 0; border: 0; outline: 0; background: transparent; color: inherit; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; letter-spacing: 0; }
    .go-button { width: 30px; height: 28px; flex: 0 0 30px; display: grid; place-items: center; border: 0; border-radius: 5px; background: transparent; color: light-dark(#49515c, #bdc5d0); cursor: pointer; }
    .go-button:hover { background: light-dark(#e8eaed, #292c32); }
    .go-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .status { position: fixed; left: 124px; right: 44px; top: 47px; z-index: 2; min-height: 0; padding: 0 12px; color: #b42318; background: light-dark(#fff0ee, #3b2020); border: 1px solid light-dark(#f4b4ad, #713937); border-radius: 0 0 6px 6px; font-size: 12px; line-height: 26px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transform: translateY(-4px); opacity: 0; pointer-events: none; transition: opacity .12s ease, transform .12s ease; }
    .status[data-visible="true"] { opacity: 1; transform: translateY(0); }
    .progress { position: fixed; left: 0; right: 0; top: 52px; z-index: 3; height: 2px; overflow: hidden; pointer-events: none; }
    .progress::after { content: ""; display: block; width: 34%; height: 100%; background: #2f75d6; transform: translateX(-110%); opacity: 0; }
    .progress[data-loading="true"]::after { opacity: 1; animation: load 1.05s ease-in-out infinite; }
    @keyframes load { to { transform: translateX(310%); } }
  </style>
</head>
<body>
  <form id="browser-form" class="browser-bar" novalidate>
    <button id="browser-back" class="nav-button" type="button" aria-label="${htmlEscape(copy.backLabel)}" title="${htmlEscape(copy.backLabel)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <button id="browser-forward" class="nav-button" type="button" aria-label="${htmlEscape(copy.forwardLabel)}" title="${htmlEscape(copy.forwardLabel)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </button>
    <button id="browser-reload" class="nav-button" type="button" aria-label="${htmlEscape(copy.reloadLabel)}" title="${htmlEscape(copy.reloadLabel)}" data-stop-label="${htmlEscape(copy.stopLabel)}">
      <svg class="reload-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 5"/></svg>
      <svg class="stop-icon" viewBox="0 0 24 24" aria-hidden="true" hidden><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
    </button>
    <div class="address-wrap">
      <span class="route-mark" title="${htmlEscape(copy.secureRouteLabel)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>
      </span>
      <label for="browser-address" hidden>${htmlEscape(copy.addressLabel)}</label>
      <input id="browser-address" class="address-input" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${htmlEscape(copy.addressPlaceholder)}" aria-label="${htmlEscape(copy.addressLabel)}">
      <button class="go-button" type="submit" aria-label="${htmlEscape(copy.navigateLabel)}" title="${htmlEscape(copy.navigateLabel)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
    <button id="browser-devtools" class="nav-button" type="button" aria-label="${htmlEscape(copy.developerToolsLabel)}" title="${htmlEscape(copy.developerToolsLabel)}" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-3 3 3 3"/><path d="m16 9 3 3-3 3"/><path d="m14 6-4 12"/></svg>
    </button>
    <button id="browser-open-external" class="nav-button" type="button" aria-label="${htmlEscape(copy.openExternalLabel)}" title="${htmlEscape(copy.openExternalLabel)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h5v5"/><path d="m10 14 10-10"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>
    </button>
  </form>
  <div id="browser-status" class="status" role="status" aria-live="polite"></div>
  <div id="browser-progress" class="progress" aria-hidden="true"></div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`;
}
