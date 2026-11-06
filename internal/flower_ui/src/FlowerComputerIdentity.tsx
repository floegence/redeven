import { Show } from 'solid-js';
import { MonitorPointer } from '@floegence/floe-webapp-core/icons';

// Exact theSVG assets with provenance in assets/flower_computer_icons.json.
const marks = {
  apple: { src: new URL('./assets/computer-icons/apple.svg?inline', import.meta.url).href, monochrome: true },
  linux: { src: new URL('./assets/computer-icons/linux.svg?inline', import.meta.url).href, monochrome: false },
  windows: { src: new URL('./assets/computer-icons/windows.svg?inline', import.meta.url).href, monochrome: false },
  chrome: { src: new URL('./assets/computer-icons/chrome.svg?inline', import.meta.url).href, monochrome: false },
  chromium: { src: new URL('./assets/computer-icons/chromium.svg?inline', import.meta.url).href, monochrome: false },
} as const;

export function FlowerComputerBrandIcon(props: { kind: keyof typeof marks; class?: string }) {
  const mark = () => marks[props.kind];
  return <span class={`flower-computer-brand ${props.class ?? ''}`} data-computer-brand={props.kind} aria-hidden="true">
    <Show when={mark().monochrome} fallback={<img src={mark().src} alt="" draggable={false} />}>
      <span class="flower-computer-brand-mask" style={{ 'mask-image': `url("${mark().src}")` }} />
    </Show>
  </span>;
}

export function FlowerComputerEnvironmentIdentity(props: { name: string; platform?: string; label: string }) {
  const platform = () => props.platform === 'darwin' || props.platform === 'macos' ? 'macOS'
    : props.platform === 'linux' ? 'Linux' : props.platform === 'win32' || props.platform === 'windows' ? 'Windows' : props.platform;
  const mark = (): keyof typeof marks | undefined => platform() === 'macOS' ? 'apple' : platform() === 'Linux' ? 'linux' : platform() === 'Windows' ? 'windows' : undefined;
  return <div class="flower-computer-environment" aria-label={props.label}>
    <span class="flower-computer-environment-icon"><Show when={mark()} fallback={<MonitorPointer aria-hidden="true" />}>{kind => <FlowerComputerBrandIcon kind={kind()} />}</Show></span>
    <span class="flower-computer-host" title={props.name}>{props.name}</span>
    <Show when={platform()}><span class="flower-computer-platform">{platform()}</span></Show>
  </div>;
}
