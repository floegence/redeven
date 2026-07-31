export type WebServiceUnavailableCopy = Readonly<{
  locale: string;
  documentTitle: string;
  eyebrow: string;
  title: string;
  summary: string;
  targetLabel: string;
  checksTitle: string;
  serviceCheck: string;
  portCheck: string;
  retryLabel: string;
}>;

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildWebServiceUnavailableDocumentURL(
  copy: WebServiceUnavailableCopy,
  targetAddress: string,
): string {
  const document = `<!doctype html>
<html lang="${htmlEscape(copy.locale)}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(copy.documentTitle)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { min-width: 100%; min-height: 100%; margin: 0; }
    body { display: grid; place-items: center; background: light-dark(#f7f8fa, #17191e); color: light-dark(#20242b, #eef0f4); }
    main { width: min(620px, 100%); padding: 52px 36px 60px; }
    .signal { width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 24px; border: 1px solid light-dark(#e2c77d, #685a35); border-radius: 8px; background: light-dark(#fffaf0, #28251d); color: light-dark(#8a6410, #e2bd62); box-shadow: 0 1px 2px rgb(0 0 0 / 6%); }
    .signal svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .eyebrow { margin: 0 0 8px; color: light-dark(#7a5d1d, #d3b76f); font-size: 12px; font-weight: 650; line-height: 1.4; letter-spacing: 0; text-transform: uppercase; }
    h1 { margin: 0; max-width: 560px; font-size: 25px; font-weight: 650; line-height: 1.24; letter-spacing: 0; }
    .summary { margin: 12px 0 28px; max-width: 560px; color: light-dark(#626975, #aeb4bf); font-size: 15px; line-height: 1.65; }
    .target { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: 14px; padding: 13px 0; border-top: 1px solid light-dark(#dde1e7, #343840); border-bottom: 1px solid light-dark(#dde1e7, #343840); }
    .target-label { color: light-dark(#777e89, #979eaa); font-size: 12px; font-weight: 600; }
    .target code { min-width: 0; overflow: hidden; color: light-dark(#252a31, #e7e9ed); font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
    .checks { margin: 25px 0 0; }
    .checks h2 { margin: 0 0 11px; color: light-dark(#444a54, #c9cdd4); font-size: 13px; font-weight: 650; line-height: 1.4; letter-spacing: 0; }
    .checks p { position: relative; margin: 7px 0; padding-left: 18px; color: light-dark(#666d78, #aeb4bf); font-size: 13px; line-height: 1.55; }
    .checks p::before { content: ""; position: absolute; left: 1px; top: .62em; width: 5px; height: 5px; border-radius: 50%; background: light-dark(#b28a30, #d2ae57); }
    .actions { display: flex; align-items: center; margin-top: 30px; }
    .retry { min-height: 38px; display: inline-flex; align-items: center; gap: 8px; padding: 0 15px; border: 1px solid light-dark(#2767b5, #548bd1); border-radius: 6px; background: light-dark(#2f75c9, #3f78be); color: #fff; font-size: 13px; font-weight: 650; line-height: 1; text-decoration: none; box-shadow: 0 1px 2px rgb(0 0 0 / 10%); }
    .retry:hover { background: light-dark(#286ab9, #4a84cc); }
    .retry:focus-visible { outline: 2px solid light-dark(#1e5b9f, #74a5e2); outline-offset: 3px; }
    .retry svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
    @media (max-width: 520px) {
      main { padding: 36px 24px 44px; }
      h1 { font-size: 22px; }
      .target { grid-template-columns: 1fr; gap: 5px; }
      .target code { text-align: left; }
    }
  </style>
</head>
<body>
  <main>
    <div class="signal" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M9.5 14.5 14.5 9.5"/><path d="m7 17-1.2 1.2a3.5 3.5 0 0 1-5-5L5 9a3.5 3.5 0 0 1 5 0"/><path d="m17 7 1.2-1.2a3.5 3.5 0 0 1 5 5L19 15a3.5 3.5 0 0 1-5 0"/></svg>
    </div>
    <p class="eyebrow">${htmlEscape(copy.eyebrow)}</p>
    <h1>${htmlEscape(copy.title)}</h1>
    <p class="summary">${htmlEscape(copy.summary)}</p>
    <div class="target">
      <span class="target-label">${htmlEscape(copy.targetLabel)}</span>
      <code title="${htmlEscape(targetAddress)}">${htmlEscape(targetAddress)}</code>
    </div>
    <section class="checks" aria-labelledby="checks-title">
      <h2 id="checks-title">${htmlEscape(copy.checksTitle)}</h2>
      <p>${htmlEscape(copy.serviceCheck)}</p>
      <p>${htmlEscape(copy.portCheck)}</p>
    </section>
    <div class="actions">
      <a class="retry" href="#retry">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0 1 5"/></svg>
        ${htmlEscape(copy.retryLabel)}
      </a>
    </div>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(document)}`;
}
