import type { JSX } from 'solid-js';

import { CodespacesActivityBarGlyph } from './CodespacesIcon';

/* ======================================================================
   Activity rail glyphs, redrawn in floe's published rail language.

   These match `ActivityRailIcons` in @floegence/floe-webapp-core exactly:

     - 24 viewBox with stroke-width 1.5, so a 20px slot carries ~1.25px of
       ink — the same weight as the rest of the shell
     - ink confined to the 3.5..20.5 box, so every tile shares a cap height
       and the rail reads as one column
     - one stroke colour (currentColor), no fill, no opacity tricks; state
       is carried by the plate and the wrapper's colour transition
     - geometry on whole/half units so hairlines land on pixel boundaries
     - size comes from `width`/`height` attributes, letting the rail's
       `w-5 h-5` class govern the rendered box instead of an inline style
   ====================================================================== */

const RAIL_INK = 1.5;

function DockGlyph(props: {
  children: JSX.Element;
  class?: string;
  identity?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={RAIL_INK}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
      data-activity-bar-icon={props.identity}
    >
      {props.children}
    </svg>
  );
}

/** Terminal — a prompt chevron over a command caret. */
export function ActivityBarTerminalIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <path d="m7 8.5 3.5 3.5L7 15.5" />
      <path d="M12.75 15.5h4.75" />
    </DockGlyph>
  );
}

/** Files — the floe rail folder, one silhouette. */
export function ActivityBarFolderIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <path d="M3.5 17.5V6.5a2 2 0 0 1 2-2h3.35a2 2 0 0 1 1.6.8l1 1.35a2 2 0 0 0 1.6.8h3.45a2 2 0 0 1 2 2v8.05a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" />
    </DockGlyph>
  );
}

/** Monitor — a monitor frame carrying a pulse trace. */
export function ActivityBarMonitorIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M6.5 12h2.25l1.75 4 2.25-8 1.75 4h2.5" />
    </DockGlyph>
  );
}

/** Codespaces — the product mark, already authored for this rail size. */
export function ActivityBarCodespacesIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <CodespacesActivityBarGlyph />
    </DockGlyph>
  );
}

/** Web Services — a globe: outline, equator and one meridian. */
export function ActivityBarPortsIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class} identity="web-services">
      <circle cx="12" cy="12" r="8.5" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
      <path d="M12 3.5a12 8.5 0 0 1 0 17a12 8.5 0 0 1 0-17Z" />
    </DockGlyph>
  );
}

/** Host Applications — a window with a title bar and a play affordance. */
export function ActivityBarHostApplicationsIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9h17" />
      <path d="M10.25 12.5v4.25l3.75-2.125Z" />
    </DockGlyph>
  );
}

/** Containers — a stacked cube: lid, body, and the two visible edges. */
export function ActivityBarContainersIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <path d="m12 3.5 7.5 3.75L12 11 4.5 7.25 12 3.5Z" />
      <path d="m4.5 11.5 7.5 3.75 7.5-3.75" />
      <path d="m4.5 15.75 7.5 3.75 7.5-3.75" />
    </DockGlyph>
  );
}

/** Switch Environment — two opposed arrows. */
export function ActivityBarSwitchIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class} identity="switch-environment">
      <path d="M4.5 8.5h13" />
      <path d="m14.5 5.5 3 3-3 3" />
      <path d="M19.5 15.5h-13" />
      <path d="m9.5 12.5-3 3 3 3" />
    </DockGlyph>
  );
}

/** Runtime Settings — two faders on a shared rail. */
export function ActivityBarSettingsIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class} identity="runtime-settings">
      <path d="M4 8.5h5" />
      <path d="M13.5 8.5H20" />
      <circle cx="11.25" cy="8.5" r="2.25" />
      <path d="M4 15.5h9.5" />
      <path d="M18 15.5h2" />
      <circle cx="16" cy="15.5" r="2.25" />
    </DockGlyph>
  );
}
