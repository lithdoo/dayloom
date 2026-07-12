import assert from 'node:assert/strict';
import test from 'node:test';

import { VScrollView } from '@bindtty/widgets';
import { MessageList } from '../dist/components/message-list.js';
import { createViewModel } from '../dist/view-model.js';

test('MessageList disables scrollOnArrow while text input is active', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  const scrollView = findComponent(MessageList({ vm }), VScrollView);
  assert.ok(scrollView);

  vm.inputMode.set('hidden');
  assert.equal(readBinding(scrollView.props.scrollOnArrow), true);

  vm.inputMode.set('text');
  const active = findComponent(MessageList({ vm }), VScrollView);
  assert.ok(active);
  assert.equal(readBinding(active.props.scrollOnArrow), false);
});

test('MessageList uses focusStyle none and title chrome for focus', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  const root = MessageList({ vm });
  const scrollView = findComponent(root, VScrollView);
  assert.ok(scrollView);
  assert.equal(scrollView.props.focusStyle, 'none');
  assert.equal(scrollView.props.showScrollbar, true);

  const title = findTitleText(root);
  assert.ok(title);
  assert.equal(readBinding(title.props.value), 'Messages');
  assert.equal(readBinding(title.props.color), 'gray');
  assert.equal(readBinding(title.props.bold), false);

  scrollView.props.onFocusChange?.({
    id: 'dayloom-message-scroll',
    focused: true,
    reason: 'next',
  });
  assert.equal(readBinding(title.props.value), 'Messages  ↑↓');
  assert.equal(readBinding(title.props.color), 'cyan');
  assert.equal(readBinding(title.props.bold), true);

  scrollView.props.onFocusChange?.({
    id: 'dayloom-message-scroll',
    focused: false,
    reason: 'next',
  });
  assert.equal(readBinding(title.props.value), 'Messages');
  assert.equal(readBinding(title.props.color), 'gray');
  assert.equal(readBinding(title.props.bold), false);
});

test('MessageList title uses zh copy when locale is zh', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'zh' });
  const root = MessageList({ vm });
  const title = findTitleText(root);
  assert.ok(title);
  assert.equal(readBinding(title.props.value), '消息');

  const scrollView = findComponent(root, VScrollView);
  assert.ok(scrollView);
  scrollView.props.onFocusChange?.({
    id: 'dayloom-message-scroll',
    focused: true,
    reason: 'next',
  });
  assert.equal(readBinding(title.props.value), '消息  ↑↓');
});

function readBinding(binding) {
  if (binding && typeof binding === 'object' && 'get' in binding) {
    return binding.get();
  }
  return binding;
}

function findTitleText(template) {
  const texts = [];
  collectByType(template, 'text', texts);
  return (
    texts.find((node) => {
      const value = readBinding(node.props?.value);
      return (
        typeof value === 'string' &&
        (value === 'Messages' ||
          value === 'Messages  ↑↓' ||
          value === '消息' ||
          value === '消息  ↑↓')
      );
    }) ?? null
  );
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

function collectByType(template, type, out) {
  if (!template || typeof template !== 'object') return;
  if (template.kind === 'element' && template.tag === type) {
    out.push(template);
  }
  for (const child of getTemplateChildren(template)) {
    collectByType(child, type, out);
  }
}

function getTemplateChildren(template) {
  if (Array.isArray(template.children)) return template.children;
  if (template.children) return [template.children];
  return [];
}
