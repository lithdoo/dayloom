function createFailureFilesystem(delegate) {
  const pending = new Map();
  const filesystem = new Proxy(delegate, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const failure = pending.get(property);
        if (failure && (!failure.predicate || failure.predicate(...args))) {
          pending.delete(property);
          throw failure.error;
        }
        return value.apply(target, args);
      };
    },
  });
  return {
    filesystem,
    failNext(method, error = new Error(`Injected ${String(method)} failure.`), predicate) {
      pending.set(method, { error, predicate });
    },
  };
}

module.exports = { createFailureFilesystem };
