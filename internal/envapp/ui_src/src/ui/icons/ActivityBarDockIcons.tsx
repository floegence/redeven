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
      <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" stroke-opacity=".3" stroke-width="1" fill="currentColor" fill-opacity=".06" />
      <rect x="5" y="5" width="3.5" height="14" rx="2" fill="currentColor" fill-opacity=".05" />
      <line x1="8.5" y1="5" x2="8.5" y2="19" stroke="currentColor" stroke-opacity=".08" stroke-width=".5" />
      <rect x="9.5" y="6" width="3" height="1.5" rx=".75" fill="currentColor" fill-opacity=".65" />
      <rect x="13" y="6" width="4.5" height="1.5" rx=".75" fill="currentColor" fill-opacity=".18" />
      <rect x="9.5" y="8.5" width="2.5" height="1.5" rx=".75" fill="currentColor" fill-opacity=".5" />
      <rect x="12.5" y="8.5" width="4.5" height="1.5" rx=".75" fill="currentColor" fill-opacity=".14" />
      <rect x="9.5" y="11" width="4.5" height="1.5" rx=".75" fill="currentColor" fill-opacity=".12" />
      <rect x="9.5" y="11" width="2.5" height="1.5" rx=".75" fill="currentColor" fill-opacity=".45" />
      <rect x="9.5" y="13.5" width="3.5" height="1.5" rx=".75" fill="currentColor" fill-opacity=".4" />
    </svg>
  );
}

export function ActivityBarPortsIcon(props: { class?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style={{ width: '1.5rem', height: '1.5rem' }} class={props.class} aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-opacity=".3" stroke-width="1" fill="currentColor" fill-opacity=".06" />
      <ellipse cx="12" cy="5.8" rx="3.8" ry="1.2" stroke="currentColor" stroke-opacity=".16" stroke-width=".5" fill="none" />
      <ellipse cx="12" cy="10.2" rx="3.8" ry="1.2" stroke="currentColor" stroke-opacity=".16" stroke-width=".5" fill="none" />
      <path d="M12 4.5 a 5 5 0 0 0 0 7 a 5 5 0 0 0 0 -7" stroke="currentColor" stroke-opacity=".16" stroke-width=".5" fill="none" />
      <line x1="12" y1="4.5" x2="12" y2="11.5" stroke="currentColor" stroke-opacity=".16" stroke-width=".5" />
      <text x="12" y="19" text-anchor="middle" font-family="'Inter','SF Pro Display',-apple-system,sans-serif" font-size="4.5" font-weight="700" letter-spacing=".4" fill="currentColor" fill-opacity=".55">HTTP</text>
    </svg>
  );
}
