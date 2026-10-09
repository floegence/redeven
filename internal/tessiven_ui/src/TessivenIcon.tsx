import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';

// Semantic silhouettes stay legible at service-row size and in monochrome.
const glyphs: Record<string, Component> = {
  tessiven: () => <>
    <rect class="glyph-main" x="3" y="4" width="7" height="7" rx="1.5" />
    <rect class="glyph-accent" x="14" y="13" width="7" height="7" rx="1.5" />
    <path class="glyph-line" d="M7 11v6h7M17 13V7h-7" />
  </>,
  service: () => <>
    <path class="glyph-main" d="m12 2 9 5v10l-9 5-9-5V7Z" />
    <path class="glyph-cut" d="m12 7 4.5 2.5v5L12 17l-4.5-2.5v-5Z" />
    <circle class="glyph-accent" cx="12" cy="12" r="2" />
  </>,
  node: () => <>
    <path class="glyph-main" d="M4.5 3h15A1.5 1.5 0 0 1 21 4.5v4A1.5 1.5 0 0 1 19.5 10h-15A1.5 1.5 0 0 1 3 8.5v-4A1.5 1.5 0 0 1 4.5 3Zm0 11h15a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-4A1.5 1.5 0 0 1 4.5 14Z" />
    <path class="glyph-cut" d="M6 6h7v1H6zm0 11h7v1H6z" />
    <circle class="glyph-accent" cx="18" cy="6.5" r="1" />
    <circle class="glyph-accent" cx="18" cy="17.5" r="1" />
  </>,
  database: () => <>
    <path class="glyph-main" d="M4 6v12c0 4 16 4 16 0V6c0 4-16 4-16 0Z" />
    <ellipse class="glyph-accent" cx="12" cy="6" rx="8" ry="3" />
    <path class="glyph-line" d="M4 12c0 4 16 4 16 0" />
  </>,
  object_store: () => <>
    <path class="glyph-main" d="m12 2 10 5v11l-10 5L2 18V7Z" />
    <path class="glyph-accent" d="m12 2 10 5-10 5L2 7Z" />
    <path class="glyph-cut" d="M11.3 12h1.4v8.7h-1.4z" />
    <path class="glyph-line" d="m7 4.5 10 5V14" />
  </>,
  cache: () => <>
    <path class="glyph-main" d="m2 7 10-5 10 5-10 5Zm0 10 10 5 10-5-4-2-6 3-6-3Z" />
    <path class="glyph-accent" d="m2 12 10 5 10-5-4-2-6 3-6-3Z" />
  </>,
  web: () => <>
    <rect class="glyph-main" x="2" y="3" width="20" height="18" rx="2" />
    <path class="glyph-cut" d="M4 8h16v1H4zM5 12h6v6H5z" />
    <path class="glyph-accent" d="M14 12h5v2h-5zm0 4h5v2h-5z" />
  </>,
  worker: () => <>
    <rect class="glyph-main" x="3" y="5" width="18" height="16" rx="2" />
    <path class="glyph-accent" d="M6 2h12v4H6z" />
    <path class="glyph-cut" d="m10 10 6 4-6 4Z" />
  </>,
  queue: () => <>
    <rect class="glyph-main" x="2" y="3" width="15" height="5" rx="1.5" />
    <rect class="glyph-main" x="2" y="10" width="15" height="5" rx="1.5" />
    <rect class="glyph-accent" x="2" y="17" width="15" height="5" rx="1.5" />
    <path class="glyph-line" d="M20 5v14m-2-2 2 2 2-2" />
    <path class="glyph-cut" d="M5 5h7v1H5zm0 7h7v1H5zm0 7h7v1H5z" />
  </>,
  domain: () => <>
    <circle class="glyph-main" cx="12" cy="12" r="10" />
    <ellipse class="glyph-line" cx="12" cy="12" rx="4" ry="10" />
    <path class="glyph-line" d="M2 12h20M5 6h14M5 18h14" />
  </>,
  gateway: () => <>
    <path class="glyph-main" d="M3 3h13v5h-3V6H6v12h7v-2h3v5H3Z" />
    <path class="glyph-accent" d="M10 10.5h7V7l6 5-6 5v-3.5h-7Z" />
  </>,
  load_balancer: () => <>
    <path class="glyph-line" d="M12 5v7H5v6m7-6h7v6" />
    <rect class="glyph-main" x="9" y="1" width="6" height="6" rx="1" />
    <rect class="glyph-accent" x="2" y="17" width="6" height="6" rx="1" />
    <rect class="glyph-main" x="16" y="17" width="6" height="6" rx="1" />
  </>,
  cdn: () => <>
    <path class="glyph-main" d="M5 16a4 4 0 0 1-1-7.9A7 7 0 0 1 17.5 7a4.5 4.5 0 0 1 1 9Z" />
    <path class="glyph-accent" d="m11 10-5 8h5l-1 5 8-10h-6l2-3Z" />
  </>,
  nas: () => <>
    <path class="glyph-main" d="M5 3h14l3 12v6H2v-6Z" />
    <path class="glyph-accent" d="M5 14h14l-2-8H7Z" />
    <path class="glyph-cut" d="M6 17h8v1H6z" />
    <circle class="glyph-accent" cx="18" cy="17.5" r="1" />
  </>,
  filesystem: () => <>
    <path class="glyph-main" d="M2 6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />
    <path class="glyph-accent" d="M13 10h4l3 3v6h-7Z" />
    <path class="glyph-cut" d="M15 15h3v1h-3zm0 2h3v1h-3z" />
  </>,
  api: () => <>
    <path class="glyph-main" d="M3 4h7v4H7v8h3v4H3Zm13 4-4 8H9l4-8Z" />
    <path class="glyph-accent" d="M21 4h-7v4h3v8h-3v4h7Z" />
  </>,
  search: () => <>
    <circle class="glyph-main" cx="10" cy="10" r="8" />
    <circle class="glyph-cut" cx="10" cy="10" r="4" />
    <path class="glyph-accent" d="m15 13 8 7-3 3-7-8Z" />
  </>,
  scheduler: () => <>
    <rect class="glyph-main" x="2" y="4" width="17" height="16" rx="2" />
    <path class="glyph-accent" d="M5 2h2v5H5zm9 0h2v5h-2Z" />
    <path class="glyph-cut" d="M4 9h13v1H4zm1 3h3v3H5zm5 0h3v3h-3Z" />
    <circle class="glyph-cut" cx="17" cy="17" r="6" />
    <circle class="glyph-accent" cx="17" cy="17" r="5" />
    <path class="glyph-cut-line" d="M17 14v3l2 1" />
  </>,
  controller: () => <>
    <path class="glyph-outline" d="M5 3v18M12 3v18M19 3v18" />
    <rect class="glyph-main" x="2" y="6" width="6" height="4" rx="1" />
    <rect class="glyph-accent" x="9" y="14" width="6" height="4" rx="1" />
    <rect class="glyph-main" x="16" y="8" width="6" height="4" rx="1" />
  </>,
  runtime: () => <>
    <path class="glyph-outline" d="M7 2v3m5-3v3m5-3v3M7 19v3m5-3v3m5-3v3M2 7h3m-3 5h3m-3 5h3m14-10h3m-3 5h3m-3 5h3" />
    <rect class="glyph-main" x="5" y="5" width="14" height="14" rx="2" />
    <path class="glyph-cut" d="m10 8 6 4-6 4Z" />
    <path class="glyph-accent" d="M6 17h12v1H6Z" />
  </>,
  network: () => <>
    <path class="glyph-outline" d="M7 7h10v10H7Z" />
    <path class="glyph-line" d="m7 7 10 10M17 7 7 17" />
    <circle class="glyph-main" cx="5" cy="5" r="3" />
    <circle class="glyph-main" cx="19" cy="5" r="3" />
    <circle class="glyph-main" cx="5" cy="19" r="3" />
    <circle class="glyph-accent" cx="19" cy="19" r="3" />
  </>,
  dns: () => <>
    <circle class="glyph-outline" cx="8" cy="9" r="6" />
    <path class="glyph-outline" d="M2 9h12M8 3c-4 4-4 8 0 12m0-12c4 4 4 8 0 12" />
    <path class="glyph-line" d="M8 16v4h9m-1-6h4m-4-5h4" />
    <circle class="glyph-main" cx="20" cy="9" r="2" />
    <circle class="glyph-main" cx="20" cy="14" r="2" />
    <circle class="glyph-accent" cx="20" cy="20" r="2" />
  </>,
  monitoring: () => <>
    <rect class="glyph-main" x="2" y="3" width="20" height="15" rx="2" />
    <rect class="glyph-cut" x="4" y="5" width="16" height="11" rx="1" />
    <path class="glyph-line" d="M5 11h3l2-4 3 7 2-4h4" />
    <path class="glyph-main" d="M10 18h4v2h4v2H6v-2h4Z" />
  </>,
  workload: () => <>
    <path class="glyph-main" d="m12 1 6 3v6l-6 3-6-3V4ZM5 12l5 2.5v6L5 23l-5-2.5v-6Z" />
    <path class="glyph-accent" d="m18 12 5 2.5v6L18 23l-5-2.5v-6Z" />
    <path class="glyph-cut-line" d="m6 4 6 3 6-3M12 7v6m-12 1.5L5 17l5-2.5M5 17v6m8-8.5 5 2.5 5-2.5M18 17v6" />
  </>,
  coordination: () => <>
    <path class="glyph-outline" d="m12 5 8 14H4Z" />
    <circle class="glyph-main" cx="12" cy="5" r="3.5" />
    <circle class="glyph-main" cx="4" cy="19" r="3.5" />
    <circle class="glyph-accent" cx="20" cy="19" r="3.5" />
    <circle class="glyph-accent" cx="12" cy="14" r="2" />
  </>,
  security: () => <>
    <path class="glyph-main" d="m12 1 9 4v7c0 5-5 9-9 11-4-2-9-6-9-11V5Z" />
    <path class="glyph-accent" d="m12 4 6 3v5c0 3-3 6-6 8Z" />
    <path class="glyph-cut-line" d="m7 12 3 3 7-7" />
  </>,
  logging: () => <>
    <path class="glyph-main" d="M4 2h11l5 5v15H4Z" />
    <path class="glyph-accent" d="M15 2v5h5Z" />
    <path class="glyph-cut" d="M7 10h2v2H7zm4 0h6v2h-6zm-4 4h2v2H7zm4 0h6v2h-6zm-4 4h2v2H7zm4 0h6v2h-6Z" />
  </>,
  storage: () => <>
    <rect class="glyph-main" x="3" y="2" width="18" height="20" rx="2" />
    <circle class="glyph-cut" cx="12" cy="10" r="5" />
    <circle class="glyph-accent" cx="12" cy="10" r="2" />
    <path class="glyph-line" d="m12 10 5-3" />
    <path class="glyph-cut" d="M6 18h7v1H6Z" />
    <circle class="glyph-accent" cx="17" cy="18.5" r="1" />
  </>,
  analytics: () => <>
    <path class="glyph-outline" d="M2 2v20h20" />
    <rect class="glyph-main" x="5" y="12" width="4" height="7" rx="1" />
    <rect class="glyph-accent" x="11" y="8" width="4" height="11" rx="1" />
    <rect class="glyph-main" x="17" y="3" width="4" height="16" rx="1" />
  </>,
  ai: () => <>
    <path class="glyph-main" d="m10 2 2.5 6.5L19 11l-6.5 2.5L10 20l-2.5-6.5L1 11l6.5-2.5Z" />
    <path class="glyph-accent" d="m19 1 1.2 3.8L24 6l-3.8 1.2L19 11l-1.2-3.8L14 6l3.8-1.2Zm0 14 1.2 2.8L23 19l-2.8 1.2L19 23l-1.2-2.8L15 19l2.8-1.2Z" />
  </>,
  external: () => <>
    <path class="glyph-main" d="M2 6h7v3H5v11h11v-4h3v7H2Z" />
    <path class="glyph-accent" d="M13 1h10v10h-3V6l-9 9-2-2 9-9h-5Z" />
  </>,
};

export function TessivenIcon(props: { kind: string; class?: string }) {
  return (
    <svg class={`tessiven-icon ${props.class ?? ''}`} data-kind={props.kind}
      viewBox="0 0 24 24" fill="none" width="23" height="23" aria-hidden="true">
      <Dynamic component={glyphs[props.kind] ?? glyphs.service} />
    </svg>
  );
}
