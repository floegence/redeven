import { describe, expect, it } from 'vitest';
import { SUBAGENT_AVATAR_PORTRAITS, subagentAvatarIdentity } from './subagentAvatarCatalog';

describe('Subagent avatar catalog', () => {
  it('provides 36 original silhouettes with their own fixed colors', () => {
    expect(SUBAGENT_AVATAR_PORTRAITS).toHaveLength(36);
    expect(new Set(SUBAGENT_AVATAR_PORTRAITS.map((portrait) => portrait.id)).size).toBe(36);
    expect(new Set(SUBAGENT_AVATAR_PORTRAITS.map((portrait) => portrait.art)).size).toBe(36);
    expect(new Set(SUBAGENT_AVATAR_PORTRAITS.map((portrait) => portrait.art.match(/fill="([^"]+)"/)?.[1])).size).toBe(36);
    for (const portrait of SUBAGENT_AVATAR_PORTRAITS) {
      expect(portrait.art).toMatch(/^<rect width="100" height="100" fill="#[A-Fa-f0-9]+"\/>/);
      expect(portrait.art).not.toMatch(/<script|<foreignObject|\son[a-z]+=|(?:href|url)\s*[=(]|var\(/i);
    }
  });

  it('keeps each thread identity stable across the complete catalog', () => {
    const identities = new Set<string>();
    for (let index = 0; index < 10_000; index++) {
      const threadID = 'thread-' + index;
      const identity = subagentAvatarIdentity(threadID);
      expect(subagentAvatarIdentity(threadID)).toBe(identity);
      expect(SUBAGENT_AVATAR_PORTRAITS).toContain(identity);
      identities.add(identity.id);
    }
    expect(identities.size).toBe(36);
    expect(subagentAvatarIdentity('<script>alert("identity")</script>').art).not.toContain('script');
  });
});
