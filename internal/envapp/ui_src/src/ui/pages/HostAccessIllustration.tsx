import { Match, Show, Switch, createUniqueId } from 'solid-js';
import type { HostAccessState } from '../services/hostAccess';

// Product illustrations describe the scope of access; adjacent localized copy
// carries their accessible meaning. No text or system-specific artwork is baked in.
export function HostAccessFeatureIllustration(props: { feature: 'applications' | 'desktop' }) {
  return (
    <svg class="host-access-scene" data-scene={props.feature} viewBox="0 0 280 132" fill="none" aria-hidden="true">
      <Show when={props.feature === 'applications'} fallback={<>
        <g class="host-access-art-selected" data-part="whole-desktop">
          <rect x="12" y="16" width="136" height="88" rx="7" class="host-access-art-tint" />
          <path d="M12 30h136M68 104v10m24-10v10m-34 0h44" />
          <rect x="24" y="40" width="66" height="39" rx="4" class="host-access-art-paper" />
          <path d="M24 50h66m-56 9h24m-24 8h36" />
          <rect x="76" y="55" width="58" height="34" rx="4" class="host-access-art-paper" />
          <path d="M76 65h58m-48 9h14m-14 6h30" />
          <path d="M62 96h6m8 0h6m8 0h6" stroke-width="3" />
        </g>
        <g class="host-access-art-selected" data-part="desktop-viewer">
          <rect x="192" y="35" width="76" height="57" rx="5" class="host-access-art-tint" />
          <path d="M192 45h76m-46 47v9m16-9v9m-27 0h38" />
          <rect x="201" y="52" width="34" height="21" rx="2" class="host-access-art-paper" />
          <rect x="227" y="63" width="31" height="18" rx="2" class="host-access-art-paper" />
          <path d="M219 86h3m6 0h3m6 0h3" stroke-width="2" />
        </g>
        <path class="host-access-art-selected host-access-transfer" d="M157 63h24m-6-6 6 6-6 6" />
      </>}>
        <g class="host-access-art-muted" data-part="unshared-desktop">
          <rect x="12" y="16" width="136" height="88" rx="7" stroke-dasharray="3 4" />
          <path d="M12 30h136m-80 74v10m24-10v10m-34 0h44" />
          <rect x="24" y="40" width="60" height="40" rx="4" />
          <path d="M24 50h60m-49 10h21m-21 8h30" />
        </g>
        <g class="host-access-art-selected" data-part="selected-window">
          <rect x="68" y="49" width="70" height="49" rx="5" class="host-access-art-paper" />
          <path d="M68 61h70" />
          <rect x="78" y="70" width="15" height="17" rx="2" class="host-access-art-tint" />
          <path d="M102 72h23m-23 7h17m-17 7h20" />
        </g>
        <g class="host-access-art-selected" data-part="single-window-viewer">
          <rect x="192" y="43" width="76" height="55" rx="5" class="host-access-art-paper" />
          <path d="M192 56h76" />
          <rect x="203" y="67" width="16" height="19" rx="2" class="host-access-art-tint" />
          <path d="M228 69h27m-27 8h18m-18 8h22" />
        </g>
        <path class="host-access-art-selected host-access-transfer" d="M148 73h33m-6-6 6 6-6 6" />
      </Show>
    </svg>
  );
}

// Product artwork distinguishes one application window from a complete desktop.
// Each instance owns its paint servers, including retained settings surfaces.
export function HostAccessFeatureMark(props: { feature: 'applications' | 'desktop' }) {
  const id = `host-feature-${createUniqueId()}`;
  return <svg class="host-access-feature-mark" data-scene={props.feature} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={props.feature === 'applications' ? {
    '--host-feature-palette-bright': 'light-dark(#8c7bd3, #ad9be8)',
    '--host-feature-palette-deep': 'light-dark(#62549f, #7160ac)',
    '--host-feature-palette-paper': 'light-dark(#f8f6ff, #eee8fc)',
    '--host-feature-palette-mist': 'light-dark(#ded9ef, #c6b9e7)',
  } : {
    '--host-feature-palette-bright': 'light-dark(#5e9cb9, #86c6df)',
    '--host-feature-palette-deep': 'light-dark(#346b89, #417c9b)',
    '--host-feature-palette-paper': 'light-dark(#f3faff, #e2f3fb)',
    '--host-feature-palette-mist': 'light-dark(#c3e0ee, #abd4e7)',
  }}>
    <defs>
      <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--host-feature-tile-top)" /><stop offset="1" stop-color="var(--host-feature-tile-bottom)" /></linearGradient>
      <linearGradient id={`${id}-shell`} x1="0" y1="0" x2=".8" y2="1"><stop stop-color="var(--host-feature-bright)" /><stop offset="1" stop-color="var(--host-feature-deep)" /></linearGradient>
      <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--host-feature-paper)" /><stop offset="1" stop-color="var(--host-feature-mist)" /></linearGradient>
    </defs>
    <rect class="host-feature-tile" x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}-tile)`} />
    <path class="host-feature-highlight" d="M18 2.5h28A15.5 15.5 0 0 1 61.5 18" stroke="var(--host-feature-bright)" stroke-opacity=".3" stroke-width="1" />
    <Show when={props.feature === 'applications'} fallback={<g data-part="complete-desktop">
      <path d="m27 45-2 8h14l-2-8" fill="var(--host-feature-deep)" />
      <rect x="21" y="52" width="22" height="3" rx="1.5" fill="var(--host-feature-bright)" />
      <rect class="host-feature-frame" x="8" y="11" width="48" height="35" rx="6" fill={`url(#${id}-shell)`} />
      <rect class="host-feature-screen" x="11" y="14" width="42" height="27" rx="3.5" fill={`url(#${id}-glass)`} />
      <path class="host-feature-wallpaper" d="M11 32c12-15 21 7 42-12v17.5a3.5 3.5 0 0 1-3.5 3.5h-35a3.5 3.5 0 0 1-3.5-3.5Z" fill="var(--host-feature-bright)" opacity=".55" />
      <rect class="host-feature-window" x="16" y="19" width="17" height="12" rx="2.5" fill="var(--host-feature-paper)" stroke="var(--host-feature-deep)" stroke-opacity=".35" stroke-width="1" />
      <path class="host-feature-detail" d="M16 23h17" stroke="var(--host-feature-bright)" stroke-width="1" />
      <rect class="host-feature-window" x="30" y="26" width="17" height="10" rx="2.5" fill="var(--host-feature-deep)" />
      <path class="host-feature-detail" d="M34 30h8m-8 3h5" stroke="var(--host-feature-paper)" stroke-width="1.3" opacity=".85" />
      <path class="host-feature-detail" d="M27 38h1m4 0h1m4 0h1" stroke="var(--host-feature-paper)" stroke-width="2" />
      <circle cx="32" cy="43.5" r=".9" fill="var(--host-feature-paper)" />
    </g>}>
      <g data-part="application-window">
        <rect class="host-feature-frame" x="9" y="13" width="46" height="38" rx="7" fill={`url(#${id}-shell)`} />
        <rect class="host-feature-screen" x="12" y="23" width="40" height="25" rx="4" fill={`url(#${id}-glass)`} />
        <path class="host-feature-detail" d="M16 18h.5m4 0h.5m4 0h.5" stroke="var(--host-feature-paper)" stroke-width="2" opacity=".85" />
        <rect class="host-feature-window" x="16" y="27" width="11" height="17" rx="3" fill={`url(#${id}-shell)`} />
        <path class="host-feature-detail" d="M32 29h13m-13 6h9m-9 6h6" stroke="var(--host-feature-deep)" stroke-width="2.5" opacity=".7" />
        <path class="host-feature-highlight" d="M16 13.5h32a6.5 6.5 0 0 1 6.5 6.5" stroke="var(--host-feature-paper)" stroke-opacity=".5" stroke-width="1" />
      </g>
    </Show>
  </svg>;
}

export function HostAccessPermissionIllustration(props: { kind: 'screen' | 'input'; desktop?: boolean }) {
  return (
    <svg class="host-access-permission-scene" data-scene={props.kind} viewBox="0 0 64 48" fill="none" aria-hidden="true">
      <Show when={props.kind === 'screen'} fallback={<>
        <g class="host-access-art-selected" data-part="keyboard">
          <rect x="4" y="23" width="38" height="21" rx="4" class="host-access-art-paper" />
          <path d="M10 29h2m5 0h2m5 0h2m5 0h2m-23 6h2m5 0h2m5 0h2m5 0h2m-16 5h13" />
        </g>
        <g class="host-access-art-selected" data-part="pointer-input">
          <rect x="42" y="5" width="16" height="13" rx="3" class="host-access-art-tint" />
          <path d="m46 13 3 26 5-7 7-1Z" class="host-access-art-paper" />
          <path d="M35 10h-5m6 7-4 3m7-17-2-3" />
        </g>
      </>}>
        <g class="host-access-art-selected" data-part="visible-picture">
          <rect x="4" y="7" width="39" height="29" rx="4" class="host-access-art-paper" />
          <path d="M4 15h39" />
          <Show when={props.desktop} fallback={<>
            <path d="M12 22h18m-18 6h12" />
          </>}>
            <path d="M17 36v5m13-5v5m-18 0h23" />
            <rect x="11" y="20" width="13" height="9" rx="1" />
            <rect x="25" y="24" width="10" height="7" rx="1" />
          </Show>
          <path d="M42 30h15m-4-4 4 4-4 4" />
          <path d="M39 40q10-13 20 0-10 12-20 0Z" class="host-access-art-paper" />
          <circle cx="49" cy="40" r="3" class="host-access-art-tint" />
        </g>
      </Show>
    </svg>
  );
}

export function HostAccessStateIllustration(props: { state: HostAccessState }) {
  return (
    <svg class="host-access-state-scene" data-scene={props.state} viewBox="0 0 68 48" fill="none" aria-hidden="true">
      <g class="host-access-art-muted"><rect x="8" y="4" width="39" height="34" rx="4" /></g>
      <g class="host-access-art-selected" data-part="retained-settings">
        <rect x="3" y="9" width="39" height="34" rx="4" class="host-access-art-paper" stroke-dasharray={props.state === 'unconfigured' ? '3 3' : undefined} />
        <Show when={props.state !== 'unconfigured'} fallback={<path d="M17 26h12m-6-6v12" />}>
          <path d="M12 20h22m-22 12h22" />
          <rect x="17" y="17" width="4" height="6" rx="1" class="host-access-art-paper" />
          <rect x="26" y="29" width="4" height="6" rx="1" class="host-access-art-paper" />
        </Show>
      </g>
      <Show when={props.state !== 'unconfigured'}>
        <g class="host-access-art-state" data-state={props.state}>
          <circle cx="51" cy="31" r="13" class="host-access-art-paper" />
          <Switch>
            <Match when={props.state === 'enabled'}><path d="m45 31 4 4 8-9" /></Match>
            <Match when={props.state === 'paused'}><path d="M47 26v10m8-10v10" stroke-width="3" /></Match>
          </Switch>
        </g>
      </Show>
    </svg>
  );
}
