const assert = require('node:assert/strict');
const test = require('node:test');
const {
  chromeClientHintPlatform,
  chromeClientHintArchitecture,
  chromeClientHintBitness,
  chromeClientHintPlatformVersion,
} = require('../../src/main/chrome-client-hints');

test('client-hint platform names match desktop Chrome', () => {
  assert.equal(chromeClientHintPlatform('darwin'), 'macOS');
  assert.equal(chromeClientHintPlatform('win32'), 'Windows');
  assert.equal(chromeClientHintPlatform('linux'), 'Linux');
  assert.equal(chromeClientHintPlatform('freebsd'), 'freebsd');
});

test('client-hint architecture and bitness normalize every supported desktop arch', () => {
  assert.equal(chromeClientHintArchitecture('arm64'), 'arm');
  assert.equal(chromeClientHintArchitecture('x64'), 'x86');
  assert.equal(chromeClientHintArchitecture('ia32'), 'x86');
  assert.equal(chromeClientHintArchitecture('riscv64'), 'riscv64');
  assert.equal(chromeClientHintBitness('arm64'), '64');
  assert.equal(chromeClientHintBitness('x64'), '64');
  assert.equal(chromeClientHintBitness('ia32'), '32');
});

test('macOS product versions are padded and other platforms stay empty', () => {
  assert.equal(chromeClientHintPlatformVersion('darwin', '26'), '26.0.0');
  assert.equal(chromeClientHintPlatformVersion('darwin', '26.1'), '26.1.0');
  assert.equal(chromeClientHintPlatformVersion('darwin', '26.1.4.9'), '26.1.4');
  assert.equal(chromeClientHintPlatformVersion('darwin', ''), '');
  assert.equal(chromeClientHintPlatformVersion('win32', '10.0.0'), '');
  assert.equal(chromeClientHintPlatformVersion('linux', '6.8.0'), '');
});
