export type EnvSidebarVisibilityMotion = 'animated' | 'instant';
type EnvConversationTab = 'ai';
const ENV_STANDARD_SIDEBAR_TABS = new Set(['tessiven']);

export const ENV_CONVERSATION_TABS = new Set<EnvConversationTab>(['ai']);

export interface ResolveEnvSidebarVisibilityMotionArgs {
  currentTab: string;
  nextTab: string;
  isMobile: boolean;
}

export function shouldEnvTabOpenSidebar(tab: string): boolean {
  return ENV_CONVERSATION_TABS.has(tab as EnvConversationTab) || ENV_STANDARD_SIDEBAR_TABS.has(tab);
}

export function resolveEnvSidebarVisibilityMotion(
  args: ResolveEnvSidebarVisibilityMotionArgs,
): EnvSidebarVisibilityMotion {
  if (args.isMobile) {
    return 'animated';
  }

  if (args.currentTab === args.nextTab) {
    return 'animated';
  }

  const currentOwnsConversationSidebar = shouldEnvTabOpenSidebar(args.currentTab);
  const nextOwnsConversationSidebar = shouldEnvTabOpenSidebar(args.nextTab);

  return currentOwnsConversationSidebar !== nextOwnsConversationSidebar ? 'instant' : 'animated';
}
