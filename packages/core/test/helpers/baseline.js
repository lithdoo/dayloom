const os = require('node:os');
const path = require('node:path');

let nextVirtualWorldId = 1;

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for predicate.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createWorld(overrides = {}) {
  return {
    phase: 'uninitialized',
    worldRoot: createVirtualWorldRoot(),
    worldId: null,
    revision: 0,
    commitId: null,
    day: null,
    lastSettledDay: null,
    initialized: false,
    invalid: null,
    invalidReason: null,
    ...overrides,
  };
}

function createVirtualWorldRoot() {
  const id = nextVirtualWorldId++;
  return path.join(os.tmpdir(), `dayloom-core-virtual-${process.pid}-${id}`);
}

async function* chunks(values) {
  for (const value of values) yield value;
}

module.exports = { chunks, createWorld, waitFor };
