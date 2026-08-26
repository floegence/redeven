export function CodespacesActivityBarGlyph() {
  return (
    <g data-codespaces-icon-surface="activity-bar">
      <rect
        data-codespaces-icon-part="workspace"
        x="4.25"
        y="4.75"
        width="15.5"
        height="14.5"
        rx="3.25"
        fill="none"
        stroke="currentColor"
        stroke-opacity=".84"
        stroke-width="1.75"
      />
      <path
        data-codespaces-icon-part="code-brackets"
        d="M9.5 9.25 7.25 12l2.25 2.75M14.5 9.25 16.75 12l-2.25 2.75"
        fill="none"
        stroke="currentColor"
        stroke-opacity=".84"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
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
      <rect
        data-codespaces-icon-part="workspace"
        x="9.5"
        y="10.25"
        width="29"
        height="27.5"
        rx="6.2"
        fill="none"
        stroke="#4f7fad"
        stroke-opacity=".86"
        stroke-width="2.25"
      />
      <path
        data-codespaces-icon-part="code-brackets"
        d="M21 17.75 15.75 24 21 30.25M27 17.75 32.25 24 27 30.25"
        fill="none"
        stroke="#4f7fad"
        stroke-opacity=".96"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
