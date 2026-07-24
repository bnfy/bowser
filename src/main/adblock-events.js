/**
 * Keep request-blocked subscribers independent of asynchronous engine
 * creation. A retry may replace the engine; each live engine forwards into
 * the same listener set, while callers subscribe exactly once.
 */
function createAdblockEventBridge() {
  const listeners = new Set();
  const boundEngines = new WeakSet();

  const bind = (engine) => {
    if (!engine || boundEngines.has(engine)) return;
    boundEngines.add(engine);
    engine.on('request-blocked', (request) => {
      for (const listener of listeners) listener(request);
    });
  };

  const onRequestBlocked = (listener) => {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { bind, onRequestBlocked };
}

module.exports = { createAdblockEventBridge };
