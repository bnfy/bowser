/**
 * Small dependency-injected controller for the asynchronous blocker startup.
 * It deliberately resolves failures into a visible `failed` state instead of
 * rejecting the app's ready chain.
 */
function createAdblockStartupController({
  initialize,
  onStateChange = () => {},
  onReleased = async () => {},
}) {
  if (typeof initialize !== 'function') throw new TypeError('initialize is required');

  let phase = 'idle';
  let attempt = 0;
  let error = null;
  let inflight = null;
  let released = false;

  const snapshot = () => ({ phase, attempt, error });
  const emit = () => onStateChange(snapshot());
  const releaseOnce = async (blocking) => {
    if (released) return;
    released = true;
    await onReleased({ blocking });
  };

  async function start() {
    if (inflight) return inflight;
    if (phase === 'ready' || phase === 'continued') return snapshot();

    attempt += 1;
    phase = 'initializing';
    error = null;
    emit();

    inflight = (async () => {
      try {
        await initialize();
      } catch (err) {
        phase = 'failed';
        error = err?.message || 'Filter lists could not be prepared.';
        emit();
        return snapshot();
      }

      phase = 'ready';
      error = null;
      emit();
      await releaseOnce(true);
      return snapshot();
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function retry() {
    if (phase !== 'failed') return Promise.resolve(snapshot());
    return start();
  }

  async function continueWithoutBlocking() {
    if (phase !== 'failed') return snapshot();
    phase = 'continued';
    error = null;
    emit();
    await releaseOnce(false);
    return snapshot();
  }

  return {
    status: snapshot,
    start,
    retry,
    continueWithoutBlocking,
  };
}

module.exports = { createAdblockStartupController };
