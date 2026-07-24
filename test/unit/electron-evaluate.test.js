const assert = require('node:assert/strict');
const test = require('node:test');

const helper = import('../desktop/support/electron-evaluate.mjs');

test('Electron main-process evaluation retries a navigation-destroyed context', async () => {
  const { evaluateElectronAppWithRetry } = await helper;
  let attempts = 0;
  const electronApp = {
    async evaluate() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error(
          'Execution context was destroyed, most likely because of a navigation.'
        );
      }
      return ['https://example.com/'];
    },
  };

  const result = await evaluateElectronAppWithRetry(
    electronApp,
    () => [],
    { timeoutMs: 100, retryMs: 0 }
  );

  assert.deepEqual(result, ['https://example.com/']);
  assert.equal(attempts, 2);
});

test('Electron main-process evaluation does not hide permanent failures', async () => {
  const { evaluateElectronAppWithRetry } = await helper;
  let attempts = 0;
  const electronApp = {
    async evaluate() {
      attempts += 1;
      throw new Error('candidate process exited');
    },
  };

  await assert.rejects(
    evaluateElectronAppWithRetry(electronApp, () => [], {
      timeoutMs: 100,
      retryMs: 0,
    }),
    /candidate process exited/
  );
  assert.equal(attempts, 1);
});
