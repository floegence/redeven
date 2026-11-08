import { Match, Show, Switch } from 'solid-js';
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

// Compact settings marks preserve the same single-window / whole-screen scope.
export function HostAccessFeatureMark(props: { feature: 'applications' | 'desktop' }) {
  return <svg class="host-access-feature-mark" data-scene={props.feature} viewBox="0 0 64 48" fill="none" aria-hidden="true">
    <Show when={props.feature === 'applications'} fallback={<g class="host-access-art-selected">
      <rect x="4" y="4" width="56" height="34" rx="4" class="host-access-art-tint" />
      <rect x="10" y="10" width="25" height="17" rx="2" class="host-access-art-paper" />
      <rect x="30" y="18" width="23" height="14" rx="2" class="host-access-art-paper" />
      <path d="M10 15h25m-5 8h23m-29 15v6m16-6v6m-22 0h28m-20-11h2m4 0h2m4 0h2" />
    </g>}><g class="host-access-art-selected">
      <rect x="7" y="7" width="50" height="34" rx="4" class="host-access-art-paper" />
      <path d="M7 16h50m-42-5h2m4 0h2m12 13h14m-14 7h10" />
      <rect x="15" y="23" width="12" height="11" rx="2" class="host-access-art-tint" />
    </g></Show>
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

export function HostAccessStateIllustration(props: { state: HostAccessState | 'remove' }) {
  return (
    <svg class="host-access-state-scene" data-scene={props.state} viewBox="0 0 68 48" fill="none" aria-hidden="true">
      <g class="host-access-art-muted"><rect x="8" y="4" width="39" height="34" rx="4" /></g>
      <g class="host-access-art-selected" data-part="retained-settings">
        <rect x="3" y="9" width="39" height="34" rx="4" class="host-access-art-paper" stroke-dasharray={props.state === 'unconfigured' || props.state === 'remove' ? '3 3' : undefined} />
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
            <Match when={props.state === 'remove'}><path d="M45 31h12" /></Match>
          </Switch>
        </g>
      </Show>
    </svg>
  );
}

// Finder-to-Settings and helper-only restart have distinct, literal scenes.
export function HostAccessHelperIllustration(props: { kind: 'locate' | 'restart' }) {
  return <svg class="host-access-helper-scene" data-scene={props.kind} viewBox="0 0 96 64" fill="none" aria-hidden="true"><g class="host-access-art-selected">
    <Show when={props.kind === 'locate'} fallback={<>
      <rect x="4" y="10" width="43" height="39" rx="4" class="host-access-art-paper" /><path d="M4 20h43m-32 8h18m-18 7h13m-13 7h18" />
      <rect x="66" y="23" width="21" height="22" rx="4" class="host-access-art-tint" /><path d="M72 29h9v7h-9zm4 7v3m-3 0h6M60 29a18 18 0 0 1 31-9m0-8v8h-8M92 40a18 18 0 0 1-31 9m0 8v-8h8" />
    </>}>
      <path d="M4 19v31a4 4 0 0 0 4 4h31a4 4 0 0 0 4-4V23H23l-5-7H8a4 4 0 0 0-4 3Z" class="host-access-art-paper" /><rect x="13" y="28" width="20" height="18" rx="3" class="host-access-art-tint" /><path d="M18 34h10m-5 0v7m-4 0h8M47 35h12m-4-4 4 4-4 4" />
      <rect x="65" y="10" width="27" height="44" rx="4" class="host-access-art-paper" /><path d="M65 20h27m-20 8h12m-12 7h12m-12 9h12m-6-6v12" />
    </Show>
  </g></svg>;
}
