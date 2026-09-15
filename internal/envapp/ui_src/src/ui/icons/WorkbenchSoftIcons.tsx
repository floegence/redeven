import { createUniqueId, For, type JSX } from 'solid-js';
import { useTheme } from '@floegence/floe-webapp-core';

function WorkbenchIconTile(props: { name: string; class?: string; children: JSX.Element }) {
  const theme = useTheme();
  const tileId = `workbench-icon-tile-${createUniqueId()}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      width="48"
      height="48"
      class={props.class}
      aria-hidden="true"
      data-workbench-icon={props.name}
      style={{
        'color-scheme': theme.resolvedTheme(),
        filter: 'drop-shadow(0 1px 1px color-mix(in srgb, var(--redeven-surface-shadow-source) 4%, transparent))',
      }}
    >
      <defs>
        <linearGradient id={tileId} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0%" stop-color="color-mix(in srgb, var(--card), #8a9fb1 12%)" />
          <stop offset="100%" stop-color="color-mix(in srgb, var(--card), #8a9fb1 18%)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${tileId})`} />
      {props.children}
    </svg>
  );
}

export function WebServicesWorkbenchIcon(props: { class?: string }) {
  const fillId = `network-fill-${createUniqueId()}`;
  const clipId = `network-clip-${createUniqueId()}`;

  return (
    <WorkbenchIconTile name="web-services" class={props.class}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="light-dark(#8baac1, #94b0c6)" />
          <stop offset="100%" stop-color="light-dark(#7c9fb9, #88a6bf)" />
        </linearGradient>
        <clipPath id={clipId}><circle cx="24" cy="24" r="14.5" /></clipPath>
      </defs>
      <circle cx="24" cy="24" r="14.5" fill={`url(#${fillId})`} />
      <g clip-path={`url(#${clipId})`} stroke="#edf3f7" stroke-width="1.25" opacity=".87">
        <ellipse cx="24" cy="24" rx="6.2" ry="14.5" />
        <path d="M9.5 24H38.5M11.4 16.5Q24 21.3 36.6 16.5M11.4 31.5Q24 26.7 36.6 31.5" />
      </g>
    </WorkbenchIconTile>
  );
}

export function CompositionWorkbenchIcon(props: { class?: string }) {
  const fillId = `artboard-fill-${createUniqueId()}`;

  return (
    <WorkbenchIconTile name="composition" class={props.class}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="light-dark(#dae3e9, #b9c8d3)" />
          <stop offset="100%" stop-color="light-dark(#d2dee6, #b3c3cf)" />
        </linearGradient>
      </defs>
      <g transform="rotate(-7 24 24)">
        <rect x="9.5" y="10.1" width="29" height="28" rx="3.7" fill="#526e85" opacity=".08" />
        <rect x="9.5" y="9.5" width="29" height="28" rx="3.7" fill={`url(#${fillId})`} stroke="#8ba1b3" stroke-opacity=".18" stroke-width=".65" />
        <rect x="13.5" y="13.5" width="8" height="20" rx="1.9" fill="#819caf" />
        <rect x="24.5" y="13.5" width="10" height="8.5" rx="1.9" fill="#a0b4c3" />
        <rect x="24.5" y="25" width="10" height="8.5" rx="1.9" fill="#edf2f5" />
      </g>
    </WorkbenchIconTile>
  );
}

export function PluginsWorkbenchIcon(props: { class?: string }) {
  const fillId = `app-fill-${createUniqueId()}`;

  return (
    <WorkbenchIconTile name="plugins" class={props.class}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="light-dark(#93a7b8, #a0b2c2)" />
          <stop offset="100%" stop-color="light-dark(#8a9fb1, #98aabb)" />
        </linearGradient>
      </defs>
      <For each={[9, 20, 31]}>{(y) => (
        <For each={[9, 20, 31]}>{(x) => (
          <>
            <rect x={x} y={y + .4} width="8" height="8" rx="2.1" fill="#526e85" opacity=".08" />
            <rect x={x} y={y} width="8" height="8" rx="2.1" fill={x === 31 && y === 9 ? '#829fb8' : `url(#${fillId})`} />
          </>
        )}</For>
      )}</For>
    </WorkbenchIconTile>
  );
}
