import { describe, expect, it } from 'vitest';
import { SUBAGENT_AVATAR_PALETTES, SUBAGENT_AVATAR_PORTRAITS, subagentAvatarArtwork, subagentAvatarIdentity } from './subagentAvatarCatalog';

describe('Subagent avatar catalog', () => {
  it('provides 99 distinct portraits and 36 distinct artwork palettes', () => {
    expect(SUBAGENT_AVATAR_PORTRAITS).toHaveLength(99);
    expect(new Set(SUBAGENT_AVATAR_PORTRAITS.map((portrait) => portrait.id)).size).toBe(99);
    expect(new Set(SUBAGENT_AVATAR_PORTRAITS.map((_, index) => subagentAvatarArtwork(index))).size).toBe(99);
    expect(SUBAGENT_AVATAR_PALETTES).toHaveLength(36);
    expect(new Set(SUBAGENT_AVATAR_PALETTES.map((palette) => JSON.stringify(palette))).size).toBe(36);
  });

  it('distributes stable identities across the complete catalog without putting identity into SVG', () => {
    const portraits = new Set<number>();
    const palettes = new Set<number>();
    for (let index = 0; index < 10_000; index++) {
      const threadID = `thread-${index}`;
      const identity = subagentAvatarIdentity(threadID);
      expect(subagentAvatarIdentity(threadID)).toEqual(identity);
      expect(subagentAvatarArtwork(identity.portrait)).toContain('<rect');
      portraits.add(identity.portrait);
      palettes.add(identity.palette);
    }
    expect(portraits.size).toBe(99);
    expect(palettes.size).toBe(36);
    const identity = subagentAvatarIdentity('<script>alert("identity")</script>');
    expect(subagentAvatarArtwork(identity.portrait)).not.toContain('script');
  });
});
