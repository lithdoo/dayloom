import assert from 'node:assert/strict';
import test from 'node:test';

import { Header } from '../dist/components/header.js';
import { LoadingBar } from '../dist/components/loading-bar.js';
import { createViewModel } from '../dist/view-model.js';

test('Header chrome text truncates instead of wrapping or widening layout', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  vm.headerPrimary.set('World: /very/long/path');
  vm.headerSecondary.set('day_0001 · very long event title');
  vm.headerActions.set(['first long action', 'second long action']);

  const texts = collectTextElements(Header({ vm }));
  assert.equal(texts.length, 2);
  assert.deepEqual(
    texts.map((node) => node.props.wrap),
    ['truncate-end', 'truncate-end'],
  );
});

test('LoadingBar chrome text truncates long labels', () => {
  const vm = createViewModel({ worldDir: '.', locale: 'en' });
  vm.loadingLabel.set('a very long loading label');

  const texts = collectTextElements(LoadingBar({ vm }));
  assert.equal(texts.length, 1);
  assert.equal(texts[0].props.wrap, 'truncate-end');
});

function collectTextElements(template) {
  const out = [];
  visit(template, out);
  return out;
}

function visit(template, out) {
  if (!template || typeof template !== 'object') return;
  if (template.kind === 'element' && template.tag === 'text') {
    out.push(template);
  }
  for (const child of getTemplateChildren(template)) {
    visit(child, out);
  }
}

function getTemplateChildren(template) {
  if (template.kind === 'show') {
    return [template.children].filter(Boolean);
  }
  if (Array.isArray(template.children)) return template.children;
  if (template.children) return [template.children];
  if (Array.isArray(template.props?.children)) return template.props.children;
  if (template.props?.children) return [template.props.children];
  return [];
}
