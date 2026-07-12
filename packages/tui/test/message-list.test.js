import assert from 'node:assert/strict';
import test from 'node:test';

import { ScrollView } from '@bindtty/widgets';
import { MessageList } from '../dist/components/message-list.js';
import { createViewModel } from '../dist/view-model.js';

test('MessageList disables scrollOnArrow while text input is active', () => {
  const vm = createViewModel({ worldDir: '.' });
  const scrollView = findComponent(MessageList({ vm }), ScrollView);
  assert.ok(scrollView);

  vm.inputMode.set('hidden');
  assert.equal(readScrollOnArrow(scrollView), true);

  vm.inputMode.set('text');
  const active = findComponent(MessageList({ vm }), ScrollView);
  assert.ok(active);
  assert.equal(readScrollOnArrow(active), false);
});

function readScrollOnArrow(template) {
  const binding = template.props.scrollOnArrow;
  if (binding && typeof binding === 'object' && 'get' in binding) {
    return binding.get();
  }
  return binding;
}

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
