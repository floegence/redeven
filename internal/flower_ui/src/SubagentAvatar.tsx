import { createMemo, type JSX } from 'solid-js';
import { subagentAvatarIdentity } from './subagentAvatarCatalog';

export function SubagentAvatar(props: Readonly<{ threadID: string; class?: string }>): JSX.Element {
  const identity = createMemo(() => subagentAvatarIdentity(props.threadID));
  return (
    <span
      class={`flower-subagent-avatar${props.class ? ` ${props.class}` : ''}`}
      data-flower-subagent-avatar={identity().id}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" fill="none" innerHTML={identity().art} />
    </span>
  );
}
