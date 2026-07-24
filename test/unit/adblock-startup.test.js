const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdblockStartupController } = require('../../src/main/adblock-startup');

test('successful initialization releases browsing once with blocking active', async () => {
  const states = [];
  const releases = [];
  const controller = createAdblockStartupController({
    initialize: async () => {},
    onStateChange: (state) => states.push(state),
    onReleased: async (result) => releases.push(result),
  });

  const result = await controller.start();
  assert.equal(result.phase, 'ready');
  assert.deepEqual(states.map(({ phase }) => phase), ['initializing', 'ready']);
  assert.deepEqual(releases, [{ blocking: true }]);

  await controller.start();
  assert.equal(releases.length, 1, 'a second start cannot release browsing twice');
});

test('failure becomes visible, retry succeeds, and the ready chain never rejects', async () => {
  let attempts = 0;
  const releases = [];
  const controller = createAdblockStartupController({
    initialize: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    },
    onReleased: async (result) => releases.push(result),
  });

  const failed = await controller.start();
  assert.deepEqual(failed, { phase: 'failed', attempt: 1, error: 'offline' });
  assert.deepEqual(releases, []);

  const ready = await controller.retry();
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.attempt, 2);
  assert.deepEqual(releases, [{ blocking: true }]);
});

test('explicit continue releases browsing once without blocking', async () => {
  const releases = [];
  const controller = createAdblockStartupController({
    initialize: async () => { throw new Error('network down'); },
    onReleased: async (result) => releases.push(result),
  });

  await controller.start();
  const result = await controller.continueWithoutBlocking();
  assert.equal(result.phase, 'continued');
  assert.deepEqual(releases, [{ blocking: false }]);

  await controller.continueWithoutBlocking();
  assert.equal(releases.length, 1);
});

test('concurrent starts share one initialization attempt', async () => {
  let resolveInitialize;
  const gate = new Promise((resolve) => { resolveInitialize = resolve; });
  let attempts = 0;
  const controller = createAdblockStartupController({
    initialize: async () => {
      attempts += 1;
      await gate;
    },
  });

  const first = controller.start();
  const second = controller.start();
  resolveInitialize();
  await Promise.all([first, second]);
  assert.equal(attempts, 1);
});
