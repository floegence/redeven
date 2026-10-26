import assert from 'node:assert/strict';

export const gatewayPickerTrigger = picker => picker.locator('[data-floe-dropdown-trigger]');
export async function openGatewayPicker(picker) {
  const trigger = gatewayPickerTrigger(picker);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const menu = picker.page().locator('#' + await trigger.getAttribute('aria-controls'));
  await menu.waitFor({ state: 'visible' });
  await picker.page().waitForFunction(id => { const menu=document.getElementById(id); return menu?.getAttribute('data-floating-presence') === 'open' && menu.getBoundingClientRect().x >= 0; }, await trigger.getAttribute('aria-controls'));
  return menu;
}
export async function gatewayPickerLabels(picker) {
  const menu = await openGatewayPicker(picker);
  const labels = await menu.getByRole('menuitem').allTextContents();
  await picker.page().keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  await picker.page().waitForFunction(id => document.activeElement?.getAttribute('aria-controls') === id, await gatewayPickerTrigger(picker).getAttribute('aria-controls'));
  return labels.map(label => label.trim());
}
export async function chooseGatewayPicker(picker, label) {
  const menu = await openGatewayPicker(picker);
  const option = menu.getByRole('menuitem').filter({ hasText: label });
  assert.equal(await option.count(), 1, 'Gateway option must be unambiguous');
  await option.click();
  await menu.waitFor({ state: 'hidden' });
}
