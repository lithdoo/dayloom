const test = require('node:test');
const assert = require('node:assert/strict');
const {
  coreStateMachine,
  getCommandAvailability,
  transitionSessionCancel,
  transitionSessionSubmit,
  transitionWorldCommand,
} = require('../../dist/index.js');
const {
  createWorld,
} = require('../helpers/baseline.js');

test('state machine exposes command availability by phase and session status', () => {
  const world = createWorld({ phase: 'idle', initialized: true });
  const session = { active: false, id: null, kind: null, status: 'none', input: null, loading: null, error: null };
  const commands = getCommandAvailability(world, session);

  assert.equal(commands.find((command) => command.name === 'daily').enabled, true);
  assert.equal(commands.find((command) => command.name === 'daily').reasonCode, null);
  assert.equal(commands.find((command) => command.name === 'revise').enabled, true);
  assert.equal(commands.find((command) => command.name === 'init').enabled, false);
  assert.equal(commands.find((command) => command.name === 'init').reasonCode, 'PHASE_MISMATCH');
  assert.equal(commands.find((command) => command.name === 'submit').enabled, false);
  assert.equal(commands.find((command) => command.name === 'submit').reasonCode, 'SESSION_REQUIRED');
});

test('state machine transitions world commands', () => {
  const emptySession = { active: false, id: null, kind: null, status: 'none', input: null, loading: null, error: null };

  let result = transitionWorldCommand(createWorld({ phase: 'uninitialized' }), emptySession, 'init');
  assert.equal(result.ok, true);
  assert.equal(result.nextWorld.phase, 'initializing');
  assert.equal(result.createSession, 'init');

  result = transitionWorldCommand(createWorld({ phase: 'planned', day: 'day_0002' }), emptySession, 'abandon-day');
  assert.equal(result.ok, true);
  assert.equal(result.nextWorld.phase, 'idle');
  assert.equal(result.nextWorld.day, 'day_0001');

  result = transitionWorldCommand(createWorld({ phase: 'idle' }), emptySession, 'play');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PHASE_MISMATCH');
});

test('state machine transitions submit and cancel', () => {
  const planningSession = {
    active: true,
    id: 'session_0001',
    kind: 'planning',
    status: 'waiting-input',
    input: null,
    loading: null,
    error: null,
  };
  let result = transitionSessionSubmit(createWorld({ phase: 'planning' }), planningSession, {
    kind: 'planning',
    day: 'day_0001',
    intent: 'Plan',
    beats: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextWorld.phase, 'planned');

  result = transitionSessionSubmit(createWorld({ phase: 'playing' }), {
    ...planningSession,
    kind: 'play',
  }, {
    kind: 'planning',
    day: 'day_0001',
    intent: 'Plan',
    beats: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SESSION_KIND_MISMATCH');

  result = transitionSessionCancel(createWorld({ phase: 'playing' }), {
    ...planningSession,
    kind: 'play',
  });
  assert.equal(result.ok, true);
  assert.equal(result.nextWorld.phase, 'planned');
});

test('phase and command availability matrix matches the command registry', () => {
  const empty = { active: false, id: null, kind: null, status: 'none', input: null, loading: null, error: null };
  const active = (kind, status = 'waiting-input') => ({
    active: true,
    id: `session_${kind}`,
    kind,
    status,
    input: null,
    loading: null,
    error: null,
  });
  const cases = [
    ['uninitialized', empty, ['init']],
    ['initializing', active('init'), ['submit', 'cancel']],
    ['idle', empty, ['daily', 'revise']],
    ['planning', active('planning'), ['submit', 'cancel']],
    ['planned', empty, ['play', 'abandon-day']],
    ['playing', active('play'), ['submit', 'cancel']],
    ['awaiting-settle', empty, ['settle', 'abandon-day']],
    ['revising', active('revise'), ['submit', 'cancel']],
    ['invalid', empty, []],
  ];

  for (const [phase, session, expected] of cases) {
    const world = createWorld({ phase, day: phase === 'planned' || phase === 'awaiting-settle' ? 'day_0001' : null });
    const enabled = coreStateMachine.getAvailableCommands({ world, session })
      .filter((command) => command.enabled)
      .map((command) => command.name);
    assert.deepEqual(enabled, expected, phase);
  }
});

test('submit and cancel availability validates Session kind and status independently', () => {
  const world = createWorld({ phase: 'playing', day: 'day_0001' });
  const session = (kind, status) => ({
    active: true,
    id: 'session_0001',
    kind,
    status,
    input: null,
    loading: null,
    error: null,
  });

  let commands = coreStateMachine.getAvailableCommands({ world, session: session('planning', 'waiting-input') });
  assert.equal(commands.find((command) => command.name === 'submit').reasonCode, 'SESSION_KIND_MISMATCH');
  assert.equal(commands.find((command) => command.name === 'cancel').reasonCode, 'SESSION_KIND_MISMATCH');

  commands = coreStateMachine.getAvailableCommands({ world, session: session('play', 'streaming') });
  assert.equal(commands.find((command) => command.name === 'submit').reasonCode, 'SESSION_STATUS_MISMATCH');
  assert.equal(commands.find((command) => command.name === 'cancel').enabled, true);

  commands = coreStateMachine.getAvailableCommands({ world, session: session('play', 'submitting') });
  assert.equal(commands.find((command) => command.name === 'submit').reasonCode, 'SESSION_STATUS_MISMATCH');
  assert.equal(commands.find((command) => command.name === 'cancel').reasonCode, 'SESSION_STATUS_MISMATCH');
});

test('settle and abandon-day require a current day', () => {
  const session = { active: false, id: null, kind: null, status: 'none', input: null, loading: null, error: null };
  for (const [phase, command] of [['awaiting-settle', 'settle'], ['planned', 'abandon-day']]) {
    const availability = coreStateMachine.getAvailableCommands({
      world: createWorld({ phase, day: null }),
      session,
    }).find((item) => item.name === command);
    assert.equal(availability.enabled, false);
    assert.equal(availability.reasonCode, 'CURRENT_DAY_REQUIRED');
  }
});

test('every enabled command has a legal transition and transitions do not mutate input', () => {
  const empty = { active: false, id: null, kind: null, status: 'none', input: null, loading: null, error: null };
  const active = (kind) => ({
    active: true,
    id: `session_${kind}`,
    kind,
    status: 'waiting-input',
    input: null,
    loading: null,
    error: null,
  });
  const cases = [
    [createWorld({ phase: 'uninitialized' }), empty],
    [createWorld({ phase: 'initializing' }), active('init')],
    [createWorld({ phase: 'idle', initialized: true }), empty],
    [createWorld({ phase: 'planning', initialized: true }), active('planning')],
    [createWorld({ phase: 'planned', initialized: true, day: 'day_0001' }), empty],
    [createWorld({ phase: 'playing', initialized: true, day: 'day_0001' }), active('play')],
    [createWorld({ phase: 'awaiting-settle', initialized: true, day: 'day_0001' }), empty],
    [createWorld({ phase: 'revising', initialized: true }), active('revise')],
  ];
  const submissions = {
    init: { kind: 'init', world: { id: 'world', title: 'World' }, canon: { premise: '', rules: '', style: '', userRole: '' } },
    planning: { kind: 'planning', day: 'day_0001', intent: 'Plan', beats: [] },
    play: { kind: 'play', day: 'day_0001', summary: 'Played', beats: [], events: [], transcript: [] },
    revise: { kind: 'revise', summary: 'Revised', canon: { premise: '', rules: '', style: '', userRole: '' } },
  };

  for (const [world, session] of cases) {
    const before = structuredClone({ world, session });
    const enabled = coreStateMachine.getAvailableCommands({ world, session }).filter((item) => item.enabled);
    for (const command of enabled) {
      let result;
      if (command.name === 'submit') result = coreStateMachine.transitionSubmit(submissions[session.kind], { world, session });
      else if (command.name === 'cancel') result = coreStateMachine.transitionCancel({ world, session });
      else result = coreStateMachine.transitionWorld(command.name, { world, session });
      assert.equal(result.ok, true, `${world.phase}:${command.name}`);
      assert.notEqual(result.nextWorld, world);
    }
    assert.deepEqual({ world, session }, before);
  }
});
