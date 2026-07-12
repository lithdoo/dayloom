import assert from 'node:assert/strict';
import test from 'node:test';

import { Textarea } from '@bindtty/widgets';
import { TextInputArea } from '../dist/components/text-input.js';
import { TEXTAREA_ID } from '../dist/components/constants.js';
import { createViewModel } from '../dist/view-model.js';

test('text input area uses @bindtty/widgets Textarea', () => {
  const vm = createViewModel({ worldDir: '.' });
  vm.beginInput(
    {
      instruction: 'instruction',
      userPrompt: '>',
      emptyBehavior: 'ignore',
    },
    () => {},
  );

  const template = TextInputArea({ vm });
  const textarea = findComponent(template, Textarea);

  assert.ok(textarea);
  assert.equal(textarea.props.id, TEXTAREA_ID);
  assert.equal(textarea.props.value, vm.inputValue);
  assert.equal(textarea.props.resetCursorToken, vm.inputResetToken);
  assert.equal(textarea.props.minRows, 1);
  assert.equal(textarea.props.maxRows, 4);
  assert.equal(typeof textarea.props.onChange, 'function');
  assert.equal(typeof textarea.props.onSubmit, 'function');
  assert.equal(typeof textarea.props.onViewportRowsChange, 'function');
});

function findComponent(template, component) {
  if (!template || typeof template !== 'object') return null;
  if (template.kind === 'component' && template.component === component) {
    return template;
  }

  for (const child of getTemplateChildren(template)) {
    const found = findComponent(child, component);
    if (found) return found;
  }

  return null;
}

function getTemplateChildren(template) {
  if (Array.isArray(template.children)) return template.children;
  if (template.children) return [template.children];
  return [];
}
