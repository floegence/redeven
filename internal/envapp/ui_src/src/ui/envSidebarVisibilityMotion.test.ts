import { describe, expect, it } from 'vitest';
import { ENV_CONVERSATION_TABS, resolveEnvSidebarVisibilityMotion, shouldEnvTabOpenSidebar } from './envSidebarVisibilityMotion';

describe('envSidebarVisibilityMotion', () => {
  it('marks Flower as a conversation-owned sidebar tab', () => {
    expect(ENV_CONVERSATION_TABS.has('ai')).toBe(true);
    expect(shouldEnvTabOpenSidebar('ai')).toBe(true);
    expect(shouldEnvTabOpenSidebar('terminal')).toBe(false);
  });

  it('returns instant when desktop navigation crosses the conversation sidebar boundary', () => {
    expect(resolveEnvSidebarVisibilityMotion({
      currentTab: 'terminal',
      nextTab: 'ai',
      isMobile: false,
    })).toBe('instant');

  });

  it('keeps animation for same-surface switches and on mobile', () => {
    expect(resolveEnvSidebarVisibilityMotion({
      currentTab: 'monitor',
      nextTab: 'monitor',
      isMobile: false,
    })).toBe('animated');

    expect(resolveEnvSidebarVisibilityMotion({
      currentTab: 'terminal',
      nextTab: 'ai',
      isMobile: true,
    })).toBe('animated');
  });
});
