const timestamp = '2026-07-22T12:00:00.000Z';

const manifest = {
  schemaVersion: 1,
  worldId: 'world-lithdoo',
  title: 'Lithdoo',
  createdAt: timestamp,
};

const pointer = {
  schemaVersion: 1,
  revision: 1,
  commitId: 'commit_01J7Q2A4P8',
  updatedAt: timestamp,
};

const commit = {
  schemaVersion: 1,
  id: 'commit_01J7Q2A4P8',
  revision: 1,
  parentCommitId: null,
  operationId: 'op_01J7Q2A4P8',
  createdAt: timestamp,
  world: {
    phase: 'planned',
    day: 'day_0001',
    lastSettledDay: null,
  },
  canonRevision: 'canon_01J7Q2A4P8',
  dayHeads: {
    day_0001: {
      revision: 'dayrev_01J7Q2A4P8',
      status: 'planned',
    },
  },
  activeSession: null,
};

const canonRevision = {
  id: 'canon_01J7Q2A4P8',
  parentRevision: null,
  operationId: 'op_01J7Q2A4P8',
  createdAt: timestamp,
  files: ['premise.md', 'rules.md', 'style.md', 'user-role.md'],
};

const dayRevision = {
  day: 'day_0001',
  revision: 'dayrev_01J7Q2A4P8',
  parentRevision: null,
  operationId: 'op_01J7Q2A4P8',
  status: 'planned',
  createdAt: timestamp,
  files: ['plan.json'],
};

const plan = {
  day: 'day_0001',
  intent: 'Investigate the signal.',
  beats: [
    {
      id: 'beat_0001',
      intent: 'Locate its source.',
      status: 'completed',
      eventId: 'event_0001',
    },
  ],
};

const play = {
  day: 'day_0001',
  summary: 'The source was located.',
  eventIds: ['event_0001'],
};

const event = {
  id: 'event_0001',
  beatId: 'beat_0001',
  userInput: 'Trace the signal.',
  assistantOutput: 'It leads beneath the station.',
  status: 'completed',
};

const transcript = [
  { sequence: 1, role: 'user', text: 'Trace the signal.', messageId: 'message_1' },
  { sequence: 2, role: 'assistant', text: 'It leads beneath the station.', messageId: 'message_2' },
];

const settlement = {
  day: 'day_0001',
  summary: 'The investigation continues.',
  settledAt: timestamp,
};

const abandoned = {
  day: 'day_0001',
  abandonedAt: timestamp,
  previousRevision: 'dayrev_01J7Q2A4P8',
};

const operation = {
  schemaVersion: 1,
  id: 'op_01J7Q2A4P8',
  type: 'submit-session',
  status: 'prepared',
  sessionOutcome: 'submitted',
  baseRevision: 1,
  baseCommitId: 'commit_01J7Q2A4P8',
  targetCommitId: 'commit_01J7Q2A4P9',
  createdAt: timestamp,
  updatedAt: timestamp,
  error: null,
};

const canon = {
  premise: 'Near-future science fiction.',
  rules: 'Keep consequences grounded.',
  style: 'Realistic.',
  userRole: 'An investigator.',
};

const submissions = {
  init: {
    kind: 'init',
    world: { id: 'world-lithdoo', title: 'Lithdoo' },
    canon,
  },
  planning: {
    kind: 'planning',
    day: 'day_0001',
    intent: plan.intent,
    beats: plan.beats.map(({ id, intent }) => ({ id, intent })),
  },
  play: {
    kind: 'play',
    day: 'day_0001',
    summary: play.summary,
    beats: plan.beats,
    events: [{
      id: event.id,
      beatId: event.beatId,
      userInput: event.userInput,
      assistantOutput: event.assistantOutput,
    }],
    transcript,
  },
  revise: {
    kind: 'revise',
    summary: 'Clarify the premise.',
    canon,
  },
};

module.exports = {
  abandoned,
  canonRevision,
  canon,
  commit,
  dayRevision,
  event,
  manifest,
  operation,
  plan,
  play,
  pointer,
  settlement,
  submissions,
  timestamp,
  transcript,
};
