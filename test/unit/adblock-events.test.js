const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createAdblockEventBridge } = require('../../src/main/adblock-events');

test('subscribers registered before engine creation receive blocked requests', () => {
  const bridge = createAdblockEventBridge();
  const requests = [];
  bridge.onRequestBlocked((request) => requests.push(request));

  const engine = new EventEmitter();
  bridge.bind(engine);
  engine.emit('request-blocked', { tabId: 42 });

  assert.deepEqual(requests, [{ tabId: 42 }]);
});

test('retry engines forward without duplicate binding and unsubscribe cleanly', () => {
  const bridge = createAdblockEventBridge();
  let count = 0;
  const unsubscribe = bridge.onRequestBlocked(() => { count += 1; });
  const first = new EventEmitter();
  const retry = new EventEmitter();

  bridge.bind(first);
  bridge.bind(first);
  bridge.bind(retry);
  first.emit('request-blocked', {});
  retry.emit('request-blocked', {});
  assert.equal(count, 2);

  unsubscribe();
  retry.emit('request-blocked', {});
  assert.equal(count, 2);
});
