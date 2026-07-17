import assert from 'node:assert/strict';
import test from 'node:test';

import { createTranslator } from '@dayloom/core';
import { footerHint, multilineInputHint, roleColor, roleLabel } from '../dist/theme.js';

test('roleLabel and roleColor support user messages', () => {
  assert.equal(roleLabel('user'), 'YOU ');
  assert.equal(roleColor('user'), 'green');
  assert.equal(roleLabel('output'), 'OUT ');
  assert.equal(roleColor('output'), 'white');
  assert.equal(roleLabel('system'), 'NEXT');
  assert.equal(roleColor('system'), 'cyan');
});

test('multilineInputHint uses Ctrl+Enter on Windows and Linux', () => {
  const t = createTranslator('en');
  assert.match(multilineInputHint(t, 'win32'), /Ctrl\+Enter/);
  assert.doesNotMatch(multilineInputHint(t, 'win32'), /Meta\+Enter|Ctrl\+Z/);
  assert.match(multilineInputHint(t, 'linux'), /Ctrl\+Enter/);
  assert.doesNotMatch(multilineInputHint(t, 'linux'), /Meta\+Enter/);
});

test('multilineInputHint mentions Meta+Enter on macOS', () => {
  const t = createTranslator('en');
  assert.match(multilineInputHint(t, 'darwin'), /Meta\+Enter/);
});

test('footerHint uses i18n loading and idle copy', () => {
  const t = createTranslator('en');
  assert.match(footerHint(t, 'thinking', ''), /disabled|Working/i);
  assert.match(footerHint(t, null, ''), /Ctrl\+Enter/);
  assert.equal(footerHint(t, null, 'custom hint'), 'custom hint');
});

test('zh locale footer and multiline hints are localized', () => {
  const t = createTranslator('zh');
  assert.match(multilineInputHint(t, 'win32'), /发送/);
  assert.match(footerHint(t, null, ''), /聚焦|发送|退出/);
});
