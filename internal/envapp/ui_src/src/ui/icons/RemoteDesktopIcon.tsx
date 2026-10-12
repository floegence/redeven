import './remote-desktop-icon.css';

export function RemoteDesktopGlyph() {
  return (
    <g class="remote-desktop-glyph" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2.5" y="3.5" width="19" height="13" rx="2.25"
        fill="var(--remote-desktop-screen, currentColor)"
        fill-opacity="var(--remote-desktop-screen-opacity, .1)"
        stroke="currentColor" stroke-width="1.5" />
      <path d="M9.5 16.5v4m-3 0h9" stroke="currentColor" stroke-width="1.5" />
      <path d="m12.5 9.5 9 3.5-4 1.5-1.5 4Z"
        fill="var(--remote-desktop-pointer, currentColor)"
        stroke="var(--remote-desktop-pointer-outline, var(--background))" stroke-width="1.1" />
    </g>
  );
}

export function RemoteDesktopIcon(props: { class?: string; size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      width={props.size ?? 24} height={props.size ?? 24} class={props.class}
      aria-hidden="true" data-remote-desktop-icon="true">
      <RemoteDesktopGlyph />
    </svg>
  );
}
