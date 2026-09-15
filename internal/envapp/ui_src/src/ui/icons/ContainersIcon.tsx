import { createUniqueId } from 'solid-js';

function ContainerModule(props: { transform: string }) {
  return (
    <g transform={props.transform}>
      <path
        d="M-.8-4.3Q0-4.75.8-4.3L6.7-.9Q7.5-.45 7.5.5V7.4Q7.5 8.3 6.7 8.75L.8 12.15Q0 12.6-.8 12.15L-6.7 8.75Q-7.5 8.3-7.5 7.4V.5Q-7.5-.45-6.7-.9Z"
        fill="#3ca7c2"
      />
      <path
        d="M0 4.35 7.5 0V7.4Q7.5 8.3 6.7 8.75L.8 12.15Q.4 12.4 0 12.4Z"
        fill="#237b9e"
      />
      <path
        d="M-.8-4.3Q0-4.75.8-4.3L6.7-.9Q7.5-.45 7.5.05L.8 3.92Q0 4.38-.8 3.92L-7.5.05Q-7.5-.45-6.7-.9Z"
        fill="#8bd6e4"
      />
      <path
        d="M-6.3-.5-.55 2.82Q0 3.13.55 2.82L6.3-.5"
        stroke="var(--redeven-surface-highlight-source)"
        stroke-opacity=".26"
        stroke-width=".55"
        stroke-linecap="round"
      />
    </g>
  );
}

export function ContainersWorkbenchIcon(props: { class?: string }) {
  const gradientId = `containers-tile-${createUniqueId()}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      width="48"
      height="48"
      class={props.class}
      aria-hidden="true"
      data-containers-icon-surface="workbench"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0%" stop-color="color-mix(in srgb, var(--card), #237b9e 8%)" />
          <stop offset="100%" stop-color="color-mix(in srgb, var(--card), #237b9e 18%)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${gradientId})`} />
      <path
        d="M14 2.5H34Q45.5 2.5 45.5 14"
        stroke="var(--redeven-surface-highlight-source)"
        stroke-opacity=".14"
        stroke-width=".6"
      />
      <ContainerModule transform="translate(24 12.4) scale(.93)" />
      <ContainerModule transform="translate(15.3 26.8) scale(.98)" />
      <ContainerModule transform="translate(32.7 26.8) scale(.98)" />
    </svg>
  );
}
