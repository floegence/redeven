import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectInputClasses, inspectInputCSS } from './checkInputFocusSources.mjs';

test('finds input styles behind a shared class constant', () => {
  assert.equal(inspectInputClasses('const fieldClass = "focus-visible:ring-2"; const v = <input class={fieldClass}/>;').violations.length, 1);
});
test('keeps button and checkbox keyboard focus styles outside the input policy', () => {
  assert.deepEqual(inspectInputClasses('<><button class="focus-visible:ring-2"/><input type="checkbox" class="focus:ring-2"/><input class="focus:outline-none"/></>').violations, []);
});
test('checks declared compound surfaces and CSS without guessing from button names', () => {
  assert.equal(inspectInputClasses('<div data-floe-input-surface class="focus-within:shadow-lg"><input/></div>').violations.length, 1);
  assert.equal(inspectInputCSS('.field:focus {outline:2px solid red;} .copy-input:focus {outline:2px solid blue;}', new Set(['field'])).length, 1);
  assert.deepEqual(inspectInputCSS('.field:focus {border-color:var(--ring);}', new Set(['field'])), []);
});
