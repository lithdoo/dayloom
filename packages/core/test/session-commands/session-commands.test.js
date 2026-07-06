const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createTranslator,
  formatAvailableCommands,
  formatCommandHelp,
  formatUnknownCommand,
  parseSessionCommand,
} = {
  ...require('../../dist/i18n/index.js'),
  ...require('../../dist/session-commands/index.js'),
};

const specs = [
  { name: 'help', summary: 'Show help.' },
  { name: 'status', aliases: ['pending'], summary: 'Show status.' },
  { name: 'save', aliases: ['start'], summary: 'Save.' },
];

test('parseSessionCommand only treats slash-prefixed input as commands', () => {
  assert.deepEqual(parseSessionCommand('保存', specs), { kind: 'text', text: '保存' });
  assert.deepEqual(parseSessionCommand('please save', specs), { kind: 'text', text: 'please save' });
  assert.deepEqual(parseSessionCommand('/save', specs), { kind: 'command', name: 'save', raw: '/save' });
});

test('parseSessionCommand supports aliases and ignores command arguments', () => {
  assert.deepEqual(parseSessionCommand('/pending', specs), { kind: 'command', name: 'status', raw: '/pending' });
  assert.deepEqual(parseSessionCommand('/start now', specs), { kind: 'command', name: 'save', raw: '/start' });
  assert.deepEqual(parseSessionCommand('/SAVE', specs), { kind: 'command', name: 'save', raw: '/SAVE' });
});

test('parseSessionCommand reports unknown slash commands', () => {
  assert.deepEqual(parseSessionCommand('/unknown', specs), { kind: 'unknown', raw: '/unknown' });
});

test('format helpers describe only the provided specs', () => {
  assert.equal(formatAvailableCommands(specs), 'Available commands: /help, /status, /save\n');
  assert.match(formatCommandHelp(specs), /\/status  Show status\./);
  assert.match(formatUnknownCommand('/x'), /Unknown command: \/x/);
});

test('format helpers localize command hints and unknown commands', () => {
  const t = createTranslator('zh');
  const localized = [
    { name: 'help', summary: 'Show help.', summaryKey: 'commands.help.summary', hintKey: 'commands.help.hint' },
    { name: 'save', summary: 'Save.', summaryKey: 'commands.save.summary', hintKey: 'commands.save.hint' },
  ];
  assert.equal(formatAvailableCommands(localized, t), '可用指令：/help 帮助, /save 保存\n');
  assert.match(formatCommandHelp(localized, t), /\/save  完成并应用当前草稿。/);
  assert.match(formatUnknownCommand('/x', localized, t), /未知指令：\/x/);
  assert.match(formatUnknownCommand('/x', localized, t), /可用指令：\/help 帮助, \/save 保存/);
});
