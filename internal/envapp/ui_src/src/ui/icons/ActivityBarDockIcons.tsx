import { CodespacesActivityBarGlyph } from './CodespacesIcon';

export function ActivityBarTerminalIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style={{ width: '1.5rem', height: '1.5rem' }} class={props.class} aria-hidden="true">
      <polyline
        points="6,7 12,12 6,17"
        stroke="currentColor"
        stroke-opacity=".85"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line x1="14" y1="18" x2="18" y2="18" stroke="currentColor" stroke-opacity=".85" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

export function ActivityBarFolderIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style={{ width: '1.5rem', height: '1.5rem' }} class={props.class} aria-hidden="true">
      <path
        d="M5 7.5a1.5 1.5 0 0 1 1.5-1.5h2l1.5 1.25H17.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H6.5a1.5 1.5 0 0 1-1.5-1.5V7.5Z"
        fill="currentColor"
        fill-opacity=".85"
      />
      <path
        d="M5 7.5v8a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6H9.5L8 8.75H6.5a1.5 1.5 0 0 0-1.5-.75Z"
        fill="currentColor"
        fill-opacity=".08"
      />
    </svg>
  );
}

export function ActivityBarMonitorIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style={{ width: '1.5rem', height: '1.5rem' }} class={props.class} aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" stroke-opacity=".08" stroke-width=".5" />
      <line x1="4" y1="11" x2="20" y2="11" stroke="currentColor" stroke-opacity=".1" stroke-width=".5" />
      <line x1="4" y1="15" x2="20" y2="15" stroke="currentColor" stroke-opacity=".08" stroke-width=".5" />
      <line x1="4" y1="19" x2="20" y2="19" stroke="currentColor" stroke-opacity=".06" stroke-width=".5" />
      <path d="M3,20 L4.5,20 L7,10 L10,18 L13,12 L15,14 L17,14 L21,16 L21,22 L3,22 Z" fill="currentColor" fill-opacity=".10" />
      <polyline
        points="3,20 4.5,20 7,10 10,18 13,12 15,14 17,14 21,16"
        stroke="currentColor"
        stroke-opacity=".85"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="21" cy="16" r="1.4" fill="currentColor" fill-opacity=".2" stroke="none" />
      <circle cx="21" cy="16" r=".8" fill="currentColor" fill-opacity=".85" stroke="none" />
    </svg>
  );
}

export function ActivityBarCodespacesIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style={{ width: '1.5rem', height: '1.5rem' }} class={props.class} aria-hidden="true">
      <CodespacesActivityBarGlyph />
    </svg>
  );
}

export function ActivityBarPortsIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style={{ width: '1.5rem', height: '1.5rem' }} class={props.class} aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" stroke-opacity=".55" stroke-width="1" fill="currentColor" fill-opacity=".12" />
      <path d="M12 5 A 3 7 0 0 0 12 19 A 3 7 0 0 0 12 5" stroke="currentColor" stroke-opacity=".5" stroke-width="1.5" fill="none" stroke-linecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-opacity=".5" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

export function ActivityBarContainersIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style={{ width: '1.5rem', height: '1.5rem' }} class={props.class} aria-hidden="true">
      <path d="m12 3.8 7 3.5-7 3.5-7-3.5 7-3.5Z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-opacity=".78" stroke-width="1.35" stroke-linejoin="round" />
      <path d="m5 11.2 7 3.5 7-3.5M5 15.1l7 3.5 7-3.5" stroke="currentColor" stroke-opacity=".78" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M5 7.3v7.8M19 7.3v7.8" stroke="currentColor" stroke-opacity=".42" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  );
}

export function ActivityBarSwitchIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{ width: '18px', height: '18px' }}
      class={props.class}
      aria-hidden="true"
      data-activity-bar-icon="switch-environment"
    >
      <path
        d="m10 13 4-4m-5 7-2 2a4.2 4.2 0 0 1-6-6l5-5a4.2 4.2 0 0 1 6 0m0 10a4.2 4.2 0 0 0 6 0l5-5a4.2 4.2 0 0 0-6-6l-2 2"
        transform="translate(1 1) scale(.91)"
      />
    </svg>
  );
}

export function ActivityBarSettingsIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{ width: '18px', height: '18px' }}
      class={props.class}
      aria-hidden="true"
      data-activity-bar-icon="runtime-settings"
    >
      <path d="M5 3v4m0 4v10M12 3v10m0 4v4M19 3v2m0 4v12" />
      <rect x="3" y="7" width="4" height="4" rx="1" />
      <rect x="10" y="13" width="4" height="4" rx="1" />
      <rect x="17" y="5" width="4" height="4" rx="1" />
    </svg>
  );
}
