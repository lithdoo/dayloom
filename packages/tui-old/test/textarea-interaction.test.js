import assert from 'node:assert/strict';
import test from 'node:test';

import { Textarea } from '@bindtty/widgets';
import { TextInputArea } from '../dist/components/text-input.js';
import { CONFIRM_ID, TEXTAREA_ID } from '../dist/components/constants.js';
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

test('confirm box uses focus chrome without default inverse', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  vm.beginConfirm('Apply changes?', () => {});

  const template = TextInputArea({ vm });
  const confirm = findElementById(template, CONFIRM_ID);
  assert.ok(confirm);
  assert.equal(confirm.props.focusable, true);
  assert.equal(confirm.props.focusStyle, 'none');
  assert.equal(typeof confirm.props.onFocusChange, 'function');
  assert.equal(typeof confirm.props.onKey, 'function');

  const title = findTextValue(confirm, 'Confirm');
  assert.ok(title);
  assert.equal(readBinding(title.props.color), 'gray');
  assert.equal(readBinding(title.props.bold), false);

  confirm.props.onFocusChange?.({
    id: CONFIRM_ID,
    focused: true,
    reason: 'next',
  });
  assert.equal(readBinding(title.props.value), 'Confirm  Y/N');
  assert.equal(readBinding(title.props.color), 'cyan');
  assert.equal(readBinding(title.props.bold), true);

  confirm.props.onFocusChange?.({
    id: CONFIRM_ID,
    focused: false,
    reason: 'next',
  });
  assert.equal(readBinding(title.props.value), 'Confirm');
  assert.equal(readBinding(title.props.color), 'gray');
  assert.equal(readBinding(title.props.bold), false);
});

test('confirm box keeps y n and enter behavior', () => {
  const answers = [];
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  vm.beginConfirm('Apply changes?', (value) => answers.push(value));
  const confirm = findElementById(TextInputArea({ vm }), CONFIRM_ID);
  assert.ok(confirm);

  assert.equal(confirm.props.onKey({ input: 'n', name: 'n' }), true);
  assert.deepEqual(answers, [false]);

  vm.beginConfirm('Apply changes?', (value) => answers.push(value));
  const nextConfirm = findElementById(TextInputArea({ vm }), CONFIRM_ID);
  assert.ok(nextConfirm);
  assert.equal(nextConfirm.props.onKey({ input: '', name: 'enter' }), true);
  assert.deepEqual(answers, [false, true]);
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
  if (template.kind === 'component') {
    return [template.component(template.props)].filter(Boolean);
  }
  if (template.kind === 'show') {
    return [template.children].filter(Boolean);
  }
  if (Array.isArray(template.children)) return template.children;
  if (template.children) return [template.children];
  if (Array.isArray(template.props?.children)) return template.props.children;
  if (template.props?.children) return [template.props.children];
  return [];
}

function findElementById(template, id) {
  if (!template || typeof template !== 'object') return null;
  if (template.kind === 'element' && template.props?.id === id) {
    return template;
  }

  for (const child of getTemplateChildren(template)) {
    const found = findElementById(child, id);
    if (found) return found;
  }

  return null;
}

function findTextValue(template, expected) {
  const texts = [];
  collectByType(template, 'text', texts);
  return (
    texts.find((node) => readBinding(node.props?.value) === expected) ?? null
  );
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

function readBinding(binding) {
  if (binding && typeof binding === 'object' && 'get' in binding) {
    return binding.get();
  }
  return binding;
}
