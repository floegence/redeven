export function CodexIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="M6.5 4.5L3.5 12l3 7.5" />
      <path d="M17.5 4.5l3 7.5-3 7.5" />
      <path d="M14 4.5l-4 15" />
      <path d="M8.5 8.5h7" />
      <path d="M7.5 15.5h7" />
    </svg>
  );
}
