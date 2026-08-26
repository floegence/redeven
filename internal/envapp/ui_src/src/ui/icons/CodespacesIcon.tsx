const CODESPACES_FOLD_PATH = 'M7.6 6.35q.4-.04.67.27l.33.4q.25.3-.03.58L5.5 12l3.07 4.4q.28.29.03.59l-.33.4q-.27.31-.67.26l-3.6-4.88q-.29-.34-.29-.77t.29-.77Z';
const CODESPACES_SLASH_PATH = 'M13.36 4.2q.12-.45.57-.34l.4.11q.45.12.33.57L10.54 19.8q-.12.45-.57.34l-.4-.11q-.45-.12-.33-.57Z';

function CodespacesFoldedMark(props: {
  foldFill: string;
  foldOpacity: string;
  slashFill: string;
  slashOpacity: string;
  surface?: 'activity-bar';
  transform?: string;
}) {
  return (
    <g
      data-codespaces-icon-surface={props.surface}
      data-codespaces-icon-mark="folded-facets"
      transform={props.transform}
    >
      <path
        data-codespaces-icon-part="fold-left"
        d={CODESPACES_FOLD_PATH}
        fill={props.foldFill}
        fill-opacity={props.foldOpacity}
      />
      <path
        data-codespaces-icon-part="fold-right"
        d={CODESPACES_FOLD_PATH}
        fill={props.foldFill}
        fill-opacity={props.foldOpacity}
        transform="matrix(-1 0 0 1 24 0)"
      />
      <path
        data-codespaces-icon-part="slash-facet"
        d={CODESPACES_SLASH_PATH}
        fill={props.slashFill}
        fill-opacity={props.slashOpacity}
      />
    </g>
  );
}

export function CodespacesActivityBarGlyph() {
  return (
    <CodespacesFoldedMark
      foldFill="currentColor"
      foldOpacity=".86"
      slashFill="currentColor"
      slashOpacity=".78"
      surface="activity-bar"
    />
  );
}

export function CodespacesWorkbenchIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      width="48"
      height="48"
      class={props.class}
      data-codespaces-icon-surface="workbench"
    >
      <rect
        data-codespaces-icon-part="tile"
        x="2"
        y="2"
        width="44"
        height="44"
        rx="12"
        fill="color-mix(in srgb, var(--card), #315f91 12%)"
        stroke="var(--foreground)"
        stroke-opacity=".08"
      />
      <CodespacesFoldedMark
        foldFill="var(--redeven-status-info)"
        foldOpacity=".82"
        slashFill="var(--redeven-status-warning)"
        slashOpacity="1"
        transform="translate(2.4 2.4) scale(1.8)"
      />
    </svg>
  );
}
