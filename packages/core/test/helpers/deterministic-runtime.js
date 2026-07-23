function createDeterministicIdGenerator() {
  const counters = new Map();
  return {
    next(kind = 'id') {
      const value = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, value);
      return `${kind}-${value}`;
    },
  };
}

function createFakeClock(initial = '2026-01-01T00:00:00.000Z') {
  let current = new Date(initial);
  return {
    now() {
      return new Date(current);
    },
    set(value) {
      current = new Date(value);
    },
  };
}

module.exports = { createDeterministicIdGenerator, createFakeClock };
