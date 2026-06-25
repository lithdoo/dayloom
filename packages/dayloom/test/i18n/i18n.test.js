const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator, detectLocale, normalizeLocale } = require('../../dist/i18n/index.js');

test('normalizeLocale maps Chinese locales to zh and defaults to en', () => {
  assert.equal(normalizeLocale('zh-CN'), 'zh');
  assert.equal(normalizeLocale('zh_TW.UTF-8'), 'zh');
  assert.equal(normalizeLocale('Chinese'), 'zh');
  assert.equal(normalizeLocale('en_US.UTF-8'), 'en');
  assert.equal(normalizeLocale(undefined), 'en');
});

test('detectLocale prefers argv over env', () => {
  assert.equal(detectLocale(['node', 'dayloom', '--lang', 'zh'], { LANG: 'en_US.UTF-8' }), 'zh');
  assert.equal(detectLocale(['node', 'dayloom', '--lang=en'], { DAYLOOM_LANG: 'zh' }), 'en');
  assert.equal(detectLocale(['node', 'dayloom'], { DAYLOOM_LANG: 'zh' }), 'zh');
});

test('translator interpolates message variables', () => {
  const t = createTranslator('zh');
  assert.equal(t('next.nextAction', { action: 'daily' }), '下一步操作：daily');
});
