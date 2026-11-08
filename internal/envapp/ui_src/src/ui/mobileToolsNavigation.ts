export type MobileToolsPage = 'more' | 'downloads';

export function handleMobileToolsEscape(event: KeyboardEvent, page: MobileToolsPage | 'plugins' | 'closed', onBack: () => void) {
  if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing
    && page !== 'more' && page !== 'plugins' && page !== 'closed') {
    event.preventDefault();
    onBack();
  }
}
