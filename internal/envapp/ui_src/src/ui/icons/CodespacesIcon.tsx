const CODESPACES_FOLD_PATH = 'M9.2 5.95Q9.62 5.9 9.9 6.23l.35.43q.27.32-.03.62L6.4 12l3.82 4.72q.3.3.03.62l-.35.43q-.28.33-.7.28l-4.58-5.27q-.3-.35-.3-.78t.3-.78Z';
const CODESPACES_SLASH_PATH = 'M13.33 5.72q.15-.44.6-.29l.52.18q.45.15.3.6l-4.07 12.07q-.15.44-.6.29l-.52-.18q-.45-.15-.3-.6Z';

function CodespacesFoldedMark(props: {
  fill: string;
  surface?: 'activity-bar';
  transform?: string;
}) {
  return (
    <g
      data-codespaces-icon-surface={props.surface}
      data-codespaces-icon-mark="folded-facets"
      fill={props.fill}
      transform={props.transform}
    >
      <path
        data-codespaces-icon-part="fold-left"
        d={CODESPACES_FOLD_PATH}
        fill-opacity=".86"
      />
      <path
        data-codespaces-icon-part="fold-right"
        d={CODESPACES_FOLD_PATH}
        fill-opacity=".86"
        transform="matrix(-1 0 0 1 24 0)"
      />
      <path
        data-codespaces-icon-part="slash-facet"
        d={CODESPACES_SLASH_PATH}
        fill-opacity=".7"
      />
    </g>
  );
}

export function CodespacesActivityBarGlyph() {
  return <CodespacesFoldedMark fill="currentColor" surface="activity-bar" />;
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
      <CodespacesFoldedMark fill="#4f7fad" transform="translate(2.4 2.4) scale(1.8)" />
    </svg>
  );
}
