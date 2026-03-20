export function shouldSubmitOnEnterKeydown(params: {
  event: Pick<KeyboardEvent, 'isComposing' | 'key' | 'shiftKey'>;
  isComposing: boolean;
}): boolean {
  const { event, isComposing } = params;
  if (event.isComposing || isComposing) {
    return false;
  }
  return event.key === 'Enter' && !event.shiftKey;
}
