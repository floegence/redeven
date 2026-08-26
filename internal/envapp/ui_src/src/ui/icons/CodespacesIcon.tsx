const CODESPACES_FOLD_PATH = 'M8.4 6.15q.42-.05.7.28l.35.43q.27.32-.03.62L6.25 12l3.17 4.52q.3.3.03.62l-.35.43q-.28.33-.7.28l-3.81-5.07q-.3-.35-.3-.78t.3-.78Z';
const CODESPACES_SLASH_PATH = 'M13.28 4.42q.13-.43.56-.3l.48.15q.43.14.29.57L9.68 19.58q-.14.43-.57.29l-.48-.16q-.43-.14-.29-.57Z';

function CodespacesFoldedMark(props: {
  foldFill: string;
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
        fill-opacity=".86"
      />
      <path
        data-codespaces-icon-part="fold-right"
        d={CODESPACES_FOLD_PATH}
        fill={props.foldFill}
        fill-opacity=".86"
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
      slashFill="currentColor"
      slashOpacity=".74"
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
        foldFill="var(--redeven-code-muted)"
        slashFill="var(--redeven-code-token-flag)"
        slashOpacity=".92"
        transform="translate(2.4 2.4) scale(1.8)"
      />
    </svg>
  );
}
