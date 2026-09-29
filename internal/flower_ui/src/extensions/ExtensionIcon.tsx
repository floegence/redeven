import { createMemo, createSignal, Show } from 'solid-js';
import { useTheme } from '@floegence/floe-webapp-core';
import type { ExtensionIconSource } from './types';

// Product identity stays stable through search, sorting, theme changes, and reloads.
export function extensionMonogram(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = words.length > 1
    ? words.slice(0, 2).map(word => Array.from(word)[0])
    : Array.from(words[0] ?? '').slice(0, 2);
  return letters.join('').toLocaleUpperCase('en-US').slice(0, 4) || '·';
}

export function ExtensionIcon(props: { identity: string; name: string; icons?: readonly ExtensionIconSource[] }) {
  const theme = useTheme();
  const [failed, setFailed] = createSignal<ReadonlySet<string>>(new Set());
  const accent = createMemo(() => {
    let hash = 2166136261;
    for (const character of props.identity) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
    return ['var(--primary)', 'var(--info)', 'var(--success)', 'var(--warning)'][(hash >>> 0) % 4];
  });
  const source = createMemo(() => {
    const candidates = (props.icons ?? []).filter(icon =>
      (!icon.theme || icon.theme === theme.resolvedTheme()) && !failed().has(icon.src)
      && icon.src.length <= 88_000 && /^data:image\/(?:png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/]+=*$/.test(icon.src));
    return (candidates.find(icon => icon.theme === theme.resolvedTheme()) ?? candidates[0])?.src;
  });
  return <span class="flower-extension-icon" aria-hidden="true" style={{ '--extension-icon-accent': accent() }} data-supplied={!!source()}>
    <Show when={source()} keyed fallback={<span>{extensionMonogram(props.name)}</span>}>
      {src => <img src={src} alt="" width="32" height="32" decoding="async" draggable={false}
        onError={() => setFailed(previous => new Set([...previous, src]))} />}
    </Show>
  </span>;
}
