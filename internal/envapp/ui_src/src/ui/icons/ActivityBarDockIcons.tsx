import type { JSX } from 'solid-js';

import { CodespacesActivityBarGlyph } from './CodespacesIcon';

/* ======================================================================
   Activity rail glyphs.

   Drawn in floe's rail frame:

     - 24 viewBox with stroke-width 1.5, so a 20px slot carries ~1.25px of
       ink — the same weight as the rest of the shell
     - ink held inside the 3.5..20.5 box, so every tile shares a cap height
       and the rail reads as one column rather than a pile
     - size comes from `width`/`height` attributes, letting the rail's class
       govern the rendered box instead of an inline style

   Silhouettes keep the proportions the rail already had: a terminal with a
   readable chevron, a *filled* folder, a monitor that is only a trace. A
   glyph may opt out of the inherited stroke with `stroke="none"` when it is
   built from fills, and filled shapes below the rail weight carry a
   `fill-opacity` so they sit behind the stroke work instead of over it.
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
      <path d="M5.5 6.5 13 12 5.5 17.5" />
      <path d="M15.5 17.5h4" />
    </DockGlyph>
  );
}

/** Files — a filled folder whose front sheet sits over the tab band. */
export function ActivityBarFolderIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <path
        d="M3.5 8a2 2 0 0 1 2-2h3.15a2 2 0 0 1 1.6.8l.95 1.3a2 2 0 0 0 1.6.8h5.7a2 2 0 0 1 2 2v6.6a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z"
        fill="currentColor"
        fill-opacity=".76"
        stroke="none"
      />
      <path
        d="M3.5 12.25h17v4.25a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z"
        fill="currentColor"
        fill-opacity=".95"
        stroke="none"
      />
    </DockGlyph>
  );
}

/** Monitor — a pulse trace with a soft area fill, and no frame of its own. */
export function ActivityBarMonitorIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <path
        d="M3.5 15.5h2.4l2.3-8.5 2.6 12 2.4-8 1.8 4.5h5.5V19.6H3.5Z"
        fill="currentColor"
        fill-opacity=".16"
        stroke="none"
      />
      <path d="M3.5 15.5h2.4l2.3-8.5 2.6 12 2.4-8 1.8 4.5h5.5" />
    </DockGlyph>
  );
}

/** Codespaces — the product mark, drawn from fills only. */
export function ActivityBarCodespacesIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class}>
      <g stroke="none" transform="translate(1.2 1.2) scale(0.9)">
        <CodespacesActivityBarGlyph />
      </g>
    </DockGlyph>
  );
}

/** Web Services — a globe: outline, equator and one meridian. */
export function ActivityBarPortsIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class} identity="web-services">
      <circle cx="12" cy="12" r="7.5" />
      <line x1="4.5" y1="12" x2="19.5" y2="12" />
      <path d="M12 4.5a3.4 7.5 0 0 1 0 15a3.4 7.5 0 0 1 0-15Z" />
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
      <path d="M3.5 8h14" />
      <path d="m14.5 5 3 3-3 3" />
      <path d="M20.5 16h-14" />
      <path d="m9.5 13-3 3 3 3" />
    </DockGlyph>
  );
}

/** Runtime Settings — two faders on a shared rail. */
export function ActivityBarSettingsIcon(props: { class?: string }) {
  return (
    <DockGlyph class={props.class} identity="runtime-settings">
      <path d="M4 7h5" />
      <path d="M13.5 7H20" />
      <circle cx="11.25" cy="7" r="2.25" />
      <path d="M4 17h9.5" />
      <path d="M18 17h2" />
      <circle cx="16" cy="17" r="2.25" />
    </DockGlyph>
  );
}
