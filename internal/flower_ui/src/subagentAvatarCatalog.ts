import portraits from './assets/subagent-avatars.json';

// Each original portrait owns its geometry and palette. Thread identity only
// selects trusted static artwork; it never enters the SVG markup.
export const SUBAGENT_AVATAR_PORTRAITS: readonly Readonly<{ id: string; art: string }>[] = portraits;

export function subagentAvatarIdentity(threadID: string): (typeof SUBAGENT_AVATAR_PORTRAITS)[number] {
  let hash = 2166136261;
  const value = 'portrait:' + threadID;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return SUBAGENT_AVATAR_PORTRAITS[(hash >>> 0) % SUBAGENT_AVATAR_PORTRAITS.length]!;
}
