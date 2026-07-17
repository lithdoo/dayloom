import assert from 'node:assert/strict';
import test from 'node:test';

import { VScrollView } from '@bindtty/widgets';
import { MessageList } from '../dist/components/message-list.js';
import { createViewModel } from '../dist/view-model.js';

test('MessageList keeps scroll arrows active while text input is active', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  vm.inputMode.set('text');

  const scrollView = findComponent(MessageList({ vm }), VScrollView);
  assert.ok(scrollView);
  assert.equal(scrollView.props.scrollOnArrow, undefined);
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

test('MessageList wires controlled scroll offset into VScrollView', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  const root = MessageList({ vm });
  const scrollView = findComponent(root, VScrollView);
  assert.ok(scrollView);

  assert.equal(scrollView.props.offset, vm.messageScrollOffset);
  scrollView.props.onOffsetChange?.(4.8);
  assert.equal(vm.messageScrollOffset.get(), 4);
});

test('MessageList keeps role label natural and lets message text fill remaining width', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  vm.appendMessage('output', 'hello world');
  const root = MessageList({ vm });

  const label = findTextValue(root, '[OUT ] ');
  const body = findTextValue(root, 'hello world');
  assert.ok(label);
  assert.ok(body);

  assert.equal(label.props.flexShrink, 0);
  assert.equal(body.props.flexGrow, 1);
  assert.equal(body.props.flexShrink, 1);
  assert.equal(body.props.minWidth, 0);
  assert.equal(body.props.wrap, 'wrap');
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

function findTextValue(template, expected) {
  const texts = [];
  collectByType(template, 'text', texts);
  return (
    texts.find((node) => readBinding(node.props?.value) === expected) ?? null
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
  if (template.kind === 'for') {
    const items = readBinding(template.each) ?? [];
    return items.map((item, index) => template.renderItem(item, index));
  }
  if (Array.isArray(template.children)) return template.children;
  if (template.children) return [template.children];
  if (Array.isArray(template.props?.children)) return template.props.children;
  if (template.props?.children) return [template.props.children];
  return [];
}
