import { createMemo, type JSX } from 'solid-js';
import { SUBAGENT_AVATAR_PALETTES, SUBAGENT_AVATAR_PORTRAITS, subagentAvatarArtwork, subagentAvatarIdentity } from './subagentAvatarCatalog';

export function SubagentAvatar(props: Readonly<{ threadID: string; class?: string }>): JSX.Element {
  const identity = createMemo(() => subagentAvatarIdentity(props.threadID));
  return (
    <span
      class={`flower-subagent-avatar${props.class ? ` ${props.class}` : ''}`}
      data-flower-subagent-avatar={SUBAGENT_AVATAR_PORTRAITS[identity().portrait]!.id}
      data-flower-subagent-avatar-palette={identity().palette}
      style={SUBAGENT_AVATAR_PALETTES[identity().palette]}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" fill="none" innerHTML={subagentAvatarArtwork(identity().portrait)} />
    </span>
  );
}
